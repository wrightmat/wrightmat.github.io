# Undercroft Suite

Undercroft is a suite of TTRPG tools for building content and running sessions —
system-agnostic by default, D&D 5e-flavored out of the box. Each tool is a
useful generator or editor on its own, but they share one account system, one
content library, and one campaign model, so a GM can prep across several tools
and then run an actual session without leaving the suite.

This document covers the whole suite: what each tool does, how content and
accounts work across all of them, how a GM shares prepped content with a table
and shows it live during play, and — in the later sections — the UI, code, and
architecture conventions for anyone working on the codebase itself.

---

## Getting Started

Undercroft is a vanilla JavaScript + Bootstrap (loaded via CDN) front end with
a small Python backend. No build step, no npm, no `package.json`.

1. Clone the repo.
2. Make sure Python 3 is installed.
3. From the repo root, run:
   ```
   python web-server.py
   ```
   (or double-click `web-server.bat` on Windows — it runs the same command).
4. Open `http://127.0.0.1:8000/undercroft/` in a browser.

`web-server.py` reads `server.config.json` (repo root) for its host/port
(defaults to `127.0.0.1:8000`), session length, the SQLite database path
(`data/database.sqlite`, created automatically on first run), and a default
admin account (`admin` / `admin`) seeded for local development. Pass
`--config <path>` to point at a different config file.

---

## The tools

| Tool | Role |
| --- | --- |
| **Orrery** | Map creator and viewer — system-agnostic base maps, layers, grids, groups, and entity-referencing markers. |
| **Press** | Versatile printing utility — turns any saved record into a card, sheet, or booklet via authored templates. |
| **Repository** | Wiki-style campaign journal. |
| **Workbench** | Character sheet and template editor — plus the live Play view a table actually uses during a session (game log, dice rolls, "Now showing" cards). |
| **Crucible** | Monster and adversary creator — Creature Type + Archetype + Role, built from a shared feature graph. |
| **Forge** | Non-Player Character generator — identity, 4D personality axes, optional AI-written character notes. |
| **Sanctum** | Location and dungeon generator — settlements, structures, regions, and everything about them (features, assets, needs, relationships). |
| **Vault** | Spell and magic item generator — a budget-based effect economy built from the same feature graph as Crucible. |
| **Loom** | Manage data or import external content — the generic Library/System editor where every reference-data kind (Systems, Species, Archetypes, Features, Resources, and any creator-defined kind) is authored, and where external content (e.g. D&D Beyond) gets imported via mappings. |

There's no separate "Admin" tool — account tiers, content ownership, sharing,
and Campaign Group management live inside Loom (tier-gated tabs) and the
account page (`common/account.html`), both reachable from the signed-in menu
in every tool's header.

Every tool shares the same header chrome (login, tool switcher, theme toggle,
and — once signed in — the Campaign selector described below), the same
three-pane shell, and the same save/share/print plumbing described next.

---

## Shared architecture

### The Library

Nearly everything any tool produces — a System, a Location, an NPC, a Monster,
an Effect, a Template, a Map — is a **Library item**: one row in a single
database table (`library_items`), addressed by a `kind` (`location`, `npc`,
`monster`, `map`, …) and an `id`. A new kind needs no new server code — dropping
a `undercroft/common/data/kind/<kind>.json` file in (label, icon, and the two
tiers below) is enough for every generic save/list/get/delete/share route to
support it immediately.

### Accounts and tiers

Every account has one tier: **free < player < gm < creator < admin** (no other
tiers exist — check `role_rank()` comparisons, not string equality, anywhere
tier logic is enforced). Each Library kind declares a `readTier` (how high a
tier you need to *see* it) and a `writeTier` (how high a tier you need to
*save* it) — a fresh, unregistered kind defaults to "anyone can read, only an
admin can write." Most generator output (NPCs, Monsters, Effects) is wide
open; authoring-heavy kinds (Locations, Settings, Systems) require `creator`
tier or higher.

An account's session begins with registering or logging in, which issues a
session token the browser holds and sends with subsequent requests; logging
out clears it. Tier changes (promoting a player to `gm`, granting `creator`)
are an admin action, done from Loom's Users tab rather than a public
self-service flow. None of this blocks using the suite at all — see Local-first
saving below.

### Local-first saving

None of the generator tools (Forge, Crucible, Vault, Sanctum, Orrery) require
signing in. An anonymous visitor's saves go to their own browser's local
storage; a signed-in user's saves go to the server as a real, ownable,
shareable record. Signing in later doesn't strand anonymous work — every
tool's save path is "local, unless authenticated," never "local only for
guests."

### Sharing

Every Library kind supports the same sharing model, managed from each tool's
own inspector or from Loom: a record can be made **public** (anyone can read
it), or shared with a specific **user** or a **Campaign Group** (below), each
grant carrying `view` or `edit` permission. A share targeting a group applies
to every current member transparently — sharing once with a group is
equivalent to sharing individually with everyone in it, and stays current as
membership changes.

---

## Campaign Groups

A **Campaign Group** (managed in Loom) is how a GM organizes a table: an
owner, a name, and a roster of member characters. Groups are useful for two
things:

1. **A share target.** Any Library record can be shared with a group in one
   step, instantly visible to every member, instead of sharing with each
   player one at a time.
2. **A live session channel.** Each group has a running **game log** — dice
   rolls, messages, and (see below) spotlighted cards — visible to every
   member and, via a public share link, to anyone at the table without an
   account at all. Workbench's Play view polls this log every 30 seconds, so
   it works as a lightweight "what's happening right now" feed with zero setup.

### The active campaign

Once a GM has at least one group, every tool's header grows a **Campaign**
selector (next to the login control) listing that GM's own groups. Picking one
sets the *active campaign* — a single, shared selection (via `localStorage`,
scoped to the browser, not the tool) that every other tool immediately sees
too. Switch to Sanctum mid-session and the same campaign is already selected;
no re-picking it per tool.

The active campaign exists to make sharing frictionless: once one is picked,
sharing dialogs across the suite offer a one-click **"Share with \[active
campaign\]"** button alongside the full user/group picker — the common case
(share this with the table I'm currently running) takes one click instead of
finding the right group in a list every time.

---

## Showing content live: Handout widgets

This is the feature that actually makes a live session work: a GM can put a
generated card up in front of the table, live, without exporting anything or
switching to Press themselves. The Dashboard is the single place this is
controlled from — there's no separate "show to table" action buried in
Sanctum/Forge/Crucible/Vault; what's visible to players is exactly what the
GM's own Dashboard shows as toggled on.

**On the GM's side** — add a **Handout** widget from the Dashboard's
Edit-layout toolbar: pick the record (an NPC, Location, Monster, or Effect)
and, optionally, one of your saved Press templates (no template just shows a
plain name/description card). Click the eye icon on the widget's header to
show it to the active campaign, and again to stop — the icon always reflects
whether *this* Handout is the one currently visible, even after a reload.
Maps work the same way via a Map widget, or from Orrery's own signed-in menu.

**On the table's side** — Workbench's Play view (the same page a group's
public share link opens) polls the group's game log and shows a **Now
showing** panel alongside it, rendering the latest spotlighted card through
Press's own template-rendering engine — the exact same function the Handout
widget itself renders through, not a re-implementation. Showing a different
Handout replaces it instantly for everyone watching.

```mermaid
sequenceDiagram
    participant GM as GM's Dashboard (Handout widget)
    participant Server
    participant Table as Workbench Play view / share link

    GM->>GM: Add a Handout, pick a record + template
    GM->>GM: Click the eye icon to show it
    GM->>Server: Share record + template with active campaign
    GM->>Server: Post spotlight entry to the group's game log
    Table->>Server: Poll game log (every 30s)
    Server-->>Table: Latest spotlight entry (kind, id, templateId)
    Table->>Server: Fetch the entity + template
    Table->>Table: Render via Press's template engine → "Now showing"
```

A private record that's only ever been spotlighted (never explicitly shared)
still shows correctly to an anonymous visitor on the group's public share
link — spotlighting automatically grants exactly enough read access for the
currently-shown entity and template, nothing more, nothing retroactive.

---

## Maps in a campaign

Orrery maps are Library items like everything else (own/share/publish them
the same way), with two features specific to running a game:

- **Entity-referencing markers.** A marker layer holds real pins, each
  optionally pointing at any other Library entity (a Location, an NPC, a
  Monster, …) via `{ refKind, refId, label }`. Clicking a pin surfaces what
  it's linked to; dropping and dragging pins is direct click-and-drag on the
  map itself once a marker layer is selected.
- **Tiered Views.** A map can define named Views, each gating a subset of
  layers to a set of viewer tiers (e.g. a "Player" view that hides a GM-only
  secrets layer). The map's owner/editor always sees everything, unfiltered —
  Views only ever apply to someone else viewing a shared or public map.

---

## Running a session, end to end

A typical arc, using everything above together:

1. **Prep.** Build out a Setting and its Locations in Sanctum, generate NPCs
   in Forge and monsters in Crucible, roll up a few items in Vault, and lay
   out a regional map in Orrery with markers pointing at the Locations you
   just made. Design a couple of Press templates (an NPC card, a shop-goods
   card) if you don't have them already.
2. **Open the table.** Create a Campaign Group in Loom (or reuse one from a
   past session) and pick it as your active campaign — it's now selected in
   every tool's header.
3. **Share what the table needs.** From each tool's inspector, share the
   session-relevant records — one click each, since "Share with \[active
   campaign\]" is already pointed at tonight's game.
4. **Go live.** Send your players the group's share link (or have them sign
   in and open Workbench directly). Their Play view shows the game log and
   the Now-showing panel; character rolls post to the same log automatically.
5. **Run it.** Show an NPC's card when they walk into a shop. Switch to
   Orrery, drop a pin on the map for a location they just discovered. Spotlight
   a monster's stat card the moment initiative rolls. Every one of these is a
   couple of clicks from whichever tool you're already in — nobody has to
   leave the table's view to see what you show them.

---

## For developers

- `server/` — the shared Python backend (auth, the generic Library
  save/list/get/delete/share routes, Campaign Groups, kind-registry tier
  policy). No per-kind server code is needed for a new Library kind.
- `undercroft/common/` — shared JS (`js/lib/`, notably `data-manager.js` for
  all client/server data access and `auth-ui.js` for the shared header chrome)
  and shared data (`data/kind/*.json`, the kind registry; `data/help-topics.json`).
- Crucible, Forge, Sanctum, and Vault each carry their own `CLAUDE.md` with
  tool-specific design detail (conceptual model, generation algorithm, starter
  content) — read the relevant one before making changes there. The other
  five tools have no equivalent per-tool design doc yet; this README's
  Architecture Reference below is the closest thing for them.
- `AGENTS.md` (this directory) has the suite-wide coding conventions (vanilla
  JS, Bootstrap-first, shared three-pane shell) and behavioral guidelines for
  anyone (human or AI) editing this codebase.
- The sections below (UI & Style Conventions, Code Conventions, Architecture
  Reference, Adding a New System) are this repo's full developer reference —
  formerly split across several files under `common/docs/`, now consolidated
  here so there's one place to look.

---

## UI & Style Conventions

The suite-wide source of truth for layout, color, and interaction conventions
across all nine tools plus the shared `common/` shell. Keep this updated as
new tools or patterns are added — it should always describe what the code
actually does, not an aspiration.

### Shared suite assets

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
  "Panes vs. Collapsible Sections" below).
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
  (see "Help Topics Over Inline Comments" below).

### Shell layout

- **App frame (`.workbench-app`)** — apply to the `<body>` wrapper. Locks the tool
  to the viewport height; only the main canvas scrolls.
- **Header (`.workbench-header`)** — sticky, full-width, `bg-body-tertiary` with a
  bottom border. Global controls (pane toggles, auth/theme buttons) live here.
  **Built entirely by JS, not hand-typed markup**: every page's `<header>...
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

### Three-pane layout

Every tool follows the same conceptual split: **left pane** is the primary/selection
surface (system picker, generation controls, toolbar), **center pane** is the actual
content (the generated/edited record), **right pane** is the inspector for whatever's
selected in the center.

- Wrap the center `<main>` as:
  `<main class="workbench-main flex-grow-1 p-3 overflow-auto">` (plain — no
  background utility, no centered container wrapper). `.workbench-main` on its own
  already inherits the page's own dark/near-black body background and scrolls
  independently; cards (`card shadow-theme`) sit directly on that background,
  full-bleed within the pane, with `p-3` for tight spacing. This is the standard
  for every tool.
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
  tools** — the dashboard (`index.html`), the account page
  (`common/account.html`), and the docs browser (`common/docs.html`) all use
  the same `workbench-main` center pane and follow the same plain/dark treatment.
- **Cards always keep their default Bootstrap border — never add `border-0`.**
  Every center-pane card is `class="card shadow-theme"` (or `shadow-sm` for a
  denser nested card, e.g. a repeater item), full stop. Grep for `border-0`
  combined with `card` before adding a new card anywhere in the suite; if you
  find one, remove `border-0`, don't add another.
- Left/right panes: `.workbench-pane` (paints the full column with
  `var(--bs-tertiary-bg)`) wrapping `.workbench-pane-content` (padding/gap classes
  live here, on top of the grey background). Size with `.workbench-sidebar` (18rem)
  or `.workbench-sidebar-lg` (20rem). Apply `.workbench-sticky-pane` to the inner
  container when pane content should scroll independently, sticky beneath the
  header.
- Pane visibility is driven by `data-pane`, `data-pane-toggle`, and `panes.js` — see
  "Panes vs. Collapsible Sections" below.

### Panes vs. collapsible sections

Two different jobs, two different mechanisms — don't mix them:

**Panes (`common/js/lib/panes.js`)** — the left/right *pane* collapse (hide
the whole sidebar). Config lives in data attributes on the pane element:
`data-pane`, `data-pane-collapsed-class` (usually `d-none`),
`data-pane-expanded-class` (usually `d-flex`), `data-pane-initial`
(`expanded` by default; Press's right pane is the one tool that starts
`collapsed`). The toggle button matches via `data-pane-toggle="<key>"`.
`initPaneToggles()` wires clicks, sets `aria-expanded`, and swaps the toggle
button between `btn-outline-secondary` (collapsed) and `btn-secondary`
(expanded/active) — no icon change.

**Collapsible Sections (`common/js/lib/collapsible.js`)** — section-level
collapse *within* a pane — an icon button that rotates its chevron
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

This is the *only* mechanism used for this job across the whole suite. If you
need programmatic (not just click-driven) control, capture `bindCollapsibleToggle`'s
return value — it's an `apply(collapsed)` function — rather than reaching for
`bootstrap.Collapse` directly.

#### JSON Data panels — built via `createJsonDataPanel`, not hand-written markup

```js
import { createJsonDataPanel } from "../../common/js/lib/ui-components.js";

const jsonPanel = createJsonDataPanel({
  label: "JSON Data",           // heading text; always "JSON Data", not "JSON Preview"
  helpTopic: "tool.jsonPreview", // optional — omit if the section has no help entry
  getData: () => buildRecordPayload(),
});
document.querySelector("[data-tool-json-mount]")?.appendChild(jsonPanel.section);
// jsonPanel.render() replaces a direct updateJsonPreview(...)/
// createJsonPreviewRenderer(...) call — call it anywhere the underlying
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
readonly textarea render + live byte-size tooltip on the Copy button — the byte
count lives in the Copy button's own tooltip, e.g. "Copy to clipboard (1.2 KB)").
The rendered textarea uses the shared `.json-preview-text` class
(`common/css/shell.css`) for its font size — pass `rows` to `createJsonDataPanel`
for a taller/shorter panel rather than adding a modifier class.

Every JSON panel in the suite (Crucible, Forge, Vault, Loom, Orrery, Press, Sanctum,
Workbench's Template *and* Character views) is built this way, and is always the
last section in its pane. Press's Sample Data section (a JSON-paste-in, not a
read-only preview) follows the same visual/markup convention via
`createCollapsibleSection` directly rather than `createJsonDataPanel` (its textarea
is editable, not readonly) — do not confuse it with Loom's separate "Sample Raw
Data" mapping-import feature, which is an unrelated tool and untouched by any of
this.

#### Shared UI factories (`common/js/lib/ui-components.js`)

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
  content, className, panelClassName, autoBindToggle })`** — see "Panes vs.
  collapsible sections" above for the full markup shape this replaces. `content`
  is either an existing DOM node (adopted wholesale via `appendChild` — the
  standard way to migrate a section whose own content is hand-authored form
  markup you don't want to move into JS: query it with `document.querySelector`
  while it's still in its original static location, then pass it straight in)
  or a builder function `(panel) => Node|void`. `actions` are extra
  `createIconButton`-shaped configs rendered before the chevron (e.g. a Copy
  button) — their built nodes come back as `actionButtons`. **`autoBindToggle`
  defaults to `true`** (the toggle click auto-flips the panel) — set it `false`
  when the caller needs fully custom click behavior (a gated toggle, or one that
  triggers a re-render on expand). **Do not try to "intercept and veto" the
  auto-bound click with a second listener on the same toggle instead** — per the
  DOM spec, listeners registered on the event's own target fire in registration
  order regardless of the `capture` flag, so a later listener can never pre-empt
  an earlier one on the identical element; `autoBindToggle: false` is the
  correct mechanism.

Each factory returns a real, already-wired DOM node (or array of nodes) —
`.appendChild()` it into a mount point. No custom elements, no attribute-driven
auto-init to reverse-engineer. Prefer these over hand-writing the equivalent markup
for any *new* instance of these patterns; migrating old ones is a mechanical,
lower-priority cleanup, not something to hold up unrelated work for.

#### Canvas-card collapse (Workbench only) — an intentional visual variant

`.canvas-collapse-toggle` (`workbench/css/styles.css`, driven by
`workbench/js/lib/canvas-card.js`) is a compact, pill-shaped icon button used for
collapsing individual template-component cards on the canvas. It stays visually
distinct from `.collapsible-toggle` — canvas cards are a genuinely denser context
(many small cards, each with its own delete/duplicate/collapse control rail) — but
follows the same interaction language: chevron-right closed, rotated open.

### Toolbar buttons

**Order** (left → right), using only the slots a given toolbar actually needs:

> Undo, Redo → New/Add/Generate → Import → Save → Export → Print → Rename →
> Duplicate → Delete

**Button count:** a single toolbar cluster shouldn't grow past six buttons —
confirmed real problem past that point (Workbench's left-pane toolbar started
wrapping/scrolling once a seventh button was added, twice — see the Component
Inspector/Import Character history in this codebase for both real occurrences).
Hitting the limit means designing an alternative *with the user* — a secondary
toolbar, moving the new action to a more relevant location instead (a full-text
button in whatever card it actually belongs to), a mode toggle inside an
existing modal instead of a second toolbar entry, a dropdown of less-common
actions, etc. — never just letting the cluster keep growing past six.

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

Never mix in a visible text label — this part is 100% consistent suite-wide.

### Inspector / property panel field order

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
Content → Layout/Position → Appearance → Behavior → Advanced.

### nav-tabs for view switchers

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

### Help topics over inline comments

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
bullets. **These are written for the end user reading them in the app — never
mention code, file paths, function names, or implementation/migration history.**

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

### CSS organization

- **Shared, cross-tool rules live in `common/css/shell.css`.** Consolidations worth
  knowing about as precedent for future ones:
  - `.template-color-grid` / `.template-color-control` / `.template-radio-group`
    (inspector color-swatch and radio-button-group controls) — base rules live in
    `shell.css`; each tool keeps only its own real modifier
    (`.template-radio-group--single-row` in Workbench,
    `.template-radio-group--nowrap` and the 3-column `.template-color-grid`
    override in Press).
  - `.json-preview-text` — replaces three near-identical tool-prefixed classes
    that had drifted to slightly different font sizes. Settled on 0.65rem (the
    majority value); a tool can still add its own modifier class alongside it for
    genuinely different behavior (Orrery's `max-height`/`overflow`).
  - `.template-linear-track*` / `.template-circular-track*` / `.template-select-tags`
    / `.template-select-tag` / `.template-toggle-shape*` — segmented/circular
    progress widgets, tag-pill toggles, and shape-fill toggles, so a Press-rendered
    card (or any future tool) can render the same visual identity a template
    component already knows how to draw. These are genuinely component-driven
    (the component's own `shape`/`variant`/`color` config selects the class), not
    hardcoded per instance.
  - The dropzone family (`.template-dropzone`/`.workbench-dropzone`,
    `.workbench-drop-placeholder*`, `.template-dropzone-label`/
    `.workbench-dropzone-label`, `.template-container-grid`/
    `.template-container-zone`) — kept dual-classed under both names rather than
    renamed so no call site needed to change.
  - `.text-shadow-dark` / `.text-shadow-light` — the text-shadow analog to
    Bootstrap's box-shadow-only `.shadow-*` utilities. The header's own
    `.undercroft-tool-trigger-label` shares the same value via the
    `--undercroft-text-shadow-dark` custom property instead of hardcoding a
    near-duplicate rgba a second time.
  - `.circle` — a small circular marker/dot (e.g. a saving-throw proficiency
    indicator), reusable by any rendered template.
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
  Workbench's play-mode widgets). Apply the "prefix with the tool name" rule when
  a *new* class's purpose isn't already obvious/collision-safe from its own name.
- **Check for dead CSS before assuming something needs promoting or renaming** —
  grep JS *and* `common/data/template/*.json` (a class name can be load-bearing in
  stored template data without appearing in any JS file) before assuming a
  stylesheet rule is live.

### Developer checks

- Run `scripts/check-modules.mjs` before committing changes to Workbench editors —
  it runs `node --check` across shared libraries and page entry points to catch
  duplicate-identifier regressions.
- Wrap each page module in an IIFE (`(() => { /* page code */ })();`) so a
  double-evaluated script doesn't clash on top-level `const` declarations.
- After editing shared markup (toolbars, collapsible sections, nav-tabs), verify
  in a real browser — a missing `.collapsible-toggle` class or wrong data attribute
  produces no build error, just a chevron that silently never rotates.

### Template authoring

- Require the "Create Template" dialog to include a system selector, populated
  from the shared system catalog (built-in, local, and remote entries); block
  creation until a system is chosen so bindings/formulas have a schema target.

### Theme and surface colors

- Use Bootstrap semantic tokens (`bg-body`, `bg-body-secondary`,
  `bg-body-tertiary`) instead of hard-coded colors for light/dark theme support.
- Use `border-body-tertiary` on pane separators to keep dividers subtle against the
  light-grey surface.
- Avoid white backgrounds inside side panes unless a control specifically needs
  contrast (e.g. the JSON Preview card) — `.workbench-pane`'s background already
  removes white gutters above/below pane content.

---

## Code Conventions

Behavioral/architectural conventions in JS and Python, confirmed by a
full-project audit rather than invented fresh. Sibling in spirit to the UI &
Style Conventions above, which stays scoped to visual/CSS conventions.

### Process: before adding new suite UI

Before writing new UI/architecture for this suite (a new tab, a new
kind-specific editor, a new cross-tool control), answer both of these
explicitly — in the plan if using plan mode, in the response if not — rather
than deciding silently:

1. **What's the nearest existing precedent?** Name it concretely (file,
   function, tab). Something almost always already exists — this suite has
   very few genuinely novel UI shapes left to invent.
2. **Does the new thing match that precedent's *placement*, not just its
   *shape*?** A shared widget pattern (row editor, array-field editor,
   card-with-toolbar) can be reused inside a completely wrong container. Ask
   specifically: which top-level tab/view does the precedent live in, is it
   bolted onto something generic (and does that generic thing intentionally
   stay generic — e.g. Library's JSON editor is deliberately kind-agnostic,
   never kind-specific), and does the new feature's tier-gating, toolbar
   button placement, and left/main/right pane split match the precedent's?

This exists because "the conventions were already written down" has failed in
practice at least once — a real feature matched an existing pattern's *widget
shape* but missed its *architectural placement* (bolting a kind-specific
editor onto the generic Library tab's raw-JSON view, which every kind shares
and which is supposed to stay JSON-only). If the honest answer is "this
genuinely needs to diverge from the precedent," say so explicitly and state
why — don't bury the exception inside the implementation.

### Server (`server/`)

- **Read/write connection split**: reads flow through a dedicated, per-thread
  read-only connection (safe for concurrent access with no locking); writes
  — including the few that happen to occur on an otherwise-read route, like a
  session-touch or a self-healing library-item index — go through the single
  write connection under `state.lock`, held only around the actual DB touch,
  never across I/O or `sleep`. Long-running work (LLM calls, DDB proxy
  fetches) happens outside the lock entirely.
- **POST-only delete**: every delete route is a POST, never a bare DELETE verb
  with no body — keeps CSRF/confirmation handling uniform across kinds.
- **Tier checks always via `role_rank()` compare**, never a direct string
  equality against a tier name — ranks handle the free < player < gm < creator <
  admin ordering correctly; string equality doesn't compose with "at least this
  tier" checks.
- **Kind normalization once, at the route boundary** — routes normalize the
  `kind` path segment on entry; nothing downstream re-normalizes it.
- **Kind-policy caching** (`server/kinds.py`) — a kind's registry JSON
  (`common/data/kind/{id}.json`) is cached in `ServerState.kind_policy_cache`
  after first read, and invalidated for that specific kind whenever its own
  registry entry is saved through the generic content route — so an admin
  editing a kind's tier policy in Loom takes effect immediately, not after a
  restart.
- **Group membership batching** (`server/groups.py`) — listing many groups
  resolves every group's members/share-links in one batched query each
  (`_fetch_group_members_batch`, `shares.py#get_share_links_batch`), not one
  round-trip per group.

### Shared JS layer (`common/js/lib/`)

- **Widget factory shape**: `initXWidget(container, opts) → { destroy() }`.
  Every widget (`combat-tracker.js`, `game-log.js`, `handout.js`,
  `character-summary.js`, ...) follows this — a container element in, an
  options object, a teardown handle out.
- **Options-object with destructured defaults** — widget/helper constructors
  take one options object with defaults destructured inline, not positional
  arguments, so call sites stay readable as the option list grows.
- **`dataManager`/`status` always injected, never imported as singletons** — a
  widget or page receives its `dataManager`/`status` instance as a parameter;
  it never reaches for a module-level singleton. Keeps every consumer testable
  and multi-instance-safe.
- **`status?.show()` for all user-facing feedback** — success/error/info
  messages go through the injected `status` object's `show()`, not ad hoc
  `alert()`/inline DOM writes.
- **`ensureModal()` singleton-modal pattern** — a page that needs one dialog
  lazily creates and caches it (`ensureModal()`), rather than creating a new
  modal element per open.
- **Tooltip dispose/refresh discipline** — any Bootstrap tooltip attached to a
  re-rendered element is explicitly disposed before the element is replaced, to
  avoid orphaned tooltip instances accumulating on repeated re-renders.
- **Local-first `{ source, ... }` data contract** — every record read/write
  goes through `dataManager`'s `{ source: "local" | "remote", payload }` shape;
  callers never assume remote-only or local-only.
- **`data-*` attribute-driven progressive enhancement** — behavior hooks onto
  `data-*` attributes in the markup rather than JS-side element registries, so
  markup and behavior stay co-located and greppable.
- **The `@path`/`=formula` binding vocabulary** — `@foo.bar` resolves a dotted
  path against context; `=expression` evaluates a formula. This vocabulary is
  shared by `bindings.js`, `formula-engine.js`, and the mapping engine — don't
  invent a third syntax for a fourth consumer.
- **`markDirty()` debounced-persist pattern** — edits mark a record dirty and a
  debounced save fires shortly after, rather than saving on every keystroke.
- **Live-stream-as-accelerant-never-authority** — any live/websocket update is
  treated as a hint to refetch or reconcile, never as the sole source of truth;
  a page must still be correct if it never received a single live event.
- **`{ preferLocal: false }` for config/rules lookups** — any fetch of a System
  (or other config-bearing) record used to *derive rules/UI behavior* (combat
  bindings, conditions lists, lookup tables) passes `{ preferLocal: false }` so
  a Loom edit is visible immediately instead of hidden behind a stale local
  cache. Established after a real bug: HP writes silently no-oping because a
  cached System record was missing a field Loom had since added.
- **Fetch-once-and-cache for static-during-session data** — a definition file or
  derived table that can't change mid-session (a mapping definition, derived
  lookup tables) is fetched once into a module-level cached promise
  (`content-fetch.js`'s `loadCharacterMappingDefinition`/
  `loadSystemLookupTables` pattern), not re-fetched on every call.

#### Shared utility inventory

A handful of small, generic modules that came out of de-duplicating
near-identical copies scattered across tools — check here before writing a
new version of any of these:

- **`common/js/lib/ownership.js`** — `refreshOwnershipCatalog`/`allowsDelete`/
  `confirmDelete({label})` — the shared "can this user delete this record"
  check (admin bypasses everything; otherwise an owner/edit-permission
  catalog lookup) and its confirm-dialog wrapper.
- **`common/js/lib/dotted-path.js`** — `resolveDottedPath`, the shared
  path-walking mechanics `formula-engine.js`/`bindings.js`/
  `mapping-custom-functions.js` all build on (each keeps its own coercion
  behavior for a missing path — `formula-engine.js` coerces to `0`,
  `bindings.js` doesn't, correctly, since a resolved binding can be a
  string/array/boolean).
- **`common/js/lib/dnd-rules.js`** — `abilityModifier`, the one shared copy of
  D&D 5e's ability-modifier formula (Crucible, Forge both import it rather
  than each keeping their own).
- **`common/js/lib/generator-kit.js`** — shared helpers for the
  feature/recipe-based generators (`findById`/`featureLabel`/
  `readLockedFeatureIds`/`handleExport`/`listAllSystems`, plus
  `generateNoteForRecord` for the optional LLM-note step) — used by Crucible,
  Vault, Sanctum; Forge doesn't participate (no feature/recipe concept of its
  own).
- **`common/js/lib/dom.js`** — `el(tag, className, text)` and
  `setElementVisible(element, visible, displayValue)`. Always use
  `setElementVisible`, never the plain `.hidden` property, on any element
  that has (or inherits) an author CSS rule setting `display` — Bootstrap's
  `.d-flex`/`.d-grid`/etc. utility classes (declared `!important`), or even a
  plain non-`!important` custom class. The `[hidden]` rule lives in the
  user-agent stylesheet, and CSS cascade resolves origin+importance *before*
  specificity — an author-origin rule always wins over a user-agent-origin
  one regardless of `!important`, so `.hidden = true` silently does nothing
  and the element keeps rendering. This exact bug has independently shipped
  more than once before `setElementVisible` existed — check for existing
  precedent like this before repeating a bug the codebase already paid to
  learn about.
- **Kind registry `titleFields`/`metadataFields`** (`common/data/kind/{id}.json`)
  — optional per-kind fields the server's generic save/list routes read
  instead of hardcoding per-kind knowledge: `titleFields` is an ordered
  dotted-path list for what counts as a record's display title (falls back to
  `["title", "name"]`); `metadataFields` is a flat list of fields to copy into
  a list response's metadata blob (absent means none, today's default for
  most kinds). A new kind that wants either adds two lines to its own JSON —
  zero server code changes.

### Dice (`workbench/js/lib/dice.js`, `common/js/lib/widgets/dice-roll.js`)

Three additive engine primitives in `rollDiceExpression`/`DiceParser`, all
backward-compatible (a caller that passes none of this sees byte-identical
behavior to before):

- **Named dice** — an optional `dice` array param (`{id, sides, faceMap,
  color, themeOverride}[]`), converted to a lowercased-key `Map` and threaded
  into the parser. A registered id resolves as an implicit `1d<sides>`
  (`hopeDie`, `2 hopeDie`) alongside ordinary `NdM` notation in the same
  expression — a die whose own id happens to look like plain notation (`d20`)
  still resolves via the engine's existing bare-`d` grammar, never the named
  path, so it's indistinguishable from ordinary behavior.
- **`faceMap`** — a named die's optional display-only relabeling
  (`{"1":"1-3", ...}`), applied to `roll.displayLabel` at roll time. Never
  touches `roll.value` — keep/drop/success/tally all still see the real
  number.
- **`t` (tally) modifier** — `4d6kh1t>=6` counts how many of the *original*
  rolled+exploded dice satisfy a comparator, independent of what keep/drop
  discarded. Parsed identically to the existing `c`-prefixed comparators.

**A System's own dice are not a Library kind, a new Property type, or a
separate top-level array** — they're an ordinary Enum-mode Array property
with the reserved key `"dice"`, read by `extractSystemDice()`
(`dice-roll.js`). This is the same "one conventional key, no dedicated
authoring UI" shape Sanctum's Environment lookup uses (a value from the active
System's own `"environment"`-keyed generator-property field — there's no
separate "propertyTypes" concept anywhere) — not invented fresh for dice.
Each value's `name` IS the die's id (what expressions reference, e.g.
`"hopeDie"`) and its display label, same as every other Enum value in the
suite; `sides`/`color`/`themeOverride`/`faceMap`/`diceBoxType` (a Tier-3
symbol die's own vendored-theme `diceAvailable` name — see below) live in
that value's existing Extra properties (JSON) catch-all. A System with no
`"dice"` field rolls the fixed standard 7 (`resolveQuickDice`'s
`STANDARD_DICE` fallback).

`resolveActiveDice({dataManager, groupContext, character})` is the shared
priority resolver (active campaign Group's own `systemId` first, then the
character's own first Assigned System, else the standard 7) — the active
campaign Group is a real schema field (`groups.system_id`, nullable), fetched
with `{ preferLocal: false }` since it's a rules/config lookup. Dashboard's
Dice Roller widget and Character Sheet's Initiative roller call it directly;
Workbench's Dice pane applies the same priority order but through its own
pre-existing `fetchSystemDefinition` cache (handles builtins/local fallback)
rather than a second, weaker fetch path.

**A System's named Rolls/Moves follow the identical convention** — an
ordinary Enum-mode Array property with the reserved key `"rolls"`, read by
`extractSystemRolls()`. Unlike a die, a Move's `name` is only ever a
human-readable label (e.g. "Duality Roll") shown on a button, never typed
into an expression. `expression`/`resultMode` (`"band"` or `"compare"`)/
`bands`/`compare` live in the same Extra-properties-JSON catch-all dice values
use. `rollSystemMove()` wraps `rollExpression()` (so overlay/context/named
dice all just work) and evaluates the matched band/compare verdict afterward.

**Rolls/Moves and symbol dice live in the two dice-ROLLING surfaces only —
Workbench's Dice pane and Dashboard's standalone Dice Roller widget — never
in a Character/vitals widget.** Dashboard's Character widget is scoped to a
character's combat-bound Role fields (resource/value/tags/modifier) and stays
that way; Rolls/symbol dice are a System-level dice-rolling concept with no
connection to those Role bindings. The one exception is Initiative's own roll
(a `modifier`-role field), which stays on the Character widget because it IS
a combat-bound field, not a System-wide Roll.

**Tier-3 symbol dice** (Genesys-style: a die whose `sides` is an array of
`{symbols: [...]}` face objects instead of a number) live in the very same
`"dice"`-keyed array field — `extractSystemDice()` filters them OUT
(`typeof sides === "number" || sides === "F"` only), and the inverse resolver
`extractSystemSymbolDice()` filters them IN. They're deliberately unreachable
from `rollDiceExpression`/the text-expression input — a symbol pool has no
numeric total. Rolled via `rollSymbolPoolExpression()` (`dice-roll.js`), which
tries the 3D overlay first and falls back to the standalone
`rollSymbolDicePool()` (`workbench/js/lib/symbol-dice.js`, Math.random-based)
whenever the overlay isn't eligible/available — same "try physical, fall back
to simulated" shape `rollExpression()` already uses for numeric dice. Either
path tallies raw symbol counts across the pool and cancels success/failure and
advantage/threat 1:1 (triumph/despair never cancel), via the same shared
`aggregateSymbolRolls()` internal to `symbol-dice.js` so the two paths can't
drift — formatted by `formatSymbolPoolResult()`. Both dice-rolling surfaces
show a dedicated "Dice Pool" +/- stepper per symbol die instead of the normal
quick-dice grid/expression form/Moves row whenever the active System's dice
are all symbol dice — never both at once.

**3D overlay support for symbol dice** — confirmed against dice-box's own
source (not just observed behavior): a custom/symbolic die's settled
`.value` is set directly from its theme's own `colliderFaceMap` entry for the
landed physics face (`d.value = meshFaceIds[dieType][faceId]` in dice-box's
`Dice.js`) — i.e. the real resolved symbol content (a string, an array of two
symbols, or `""` for a blank face) already, not an index needing a second
lookup against this System's own `sides` face list (the two aren't even
index-aligned — dice-box's collider mesh has more physics faces per logical
symbol than this System's own face count). A symbol die opts into the overlay
via an optional `diceBoxType` value (e.g. `sys.genesys.json`'s own `boostDie`
→ `"boost"`) naming which entry in its vendored theme's own
`theme.config.json` `diceAvailable` list it rolls as — absent for any System
without a matching vendored theme, which just always uses the plain
Math.random pool, same as before this existed. `rollSymbolDiceOverlay()`
(`dice-overlay.js`) and `rollDiceOverlay()` now share one internal
`rollGroupedOverlay()` core (the theme/color grouping + single-vs-pooled-box
selection logic) parameterized only on notation-building and per-die value
extraction, so this didn't fork the numeric path's already-tuned behavior.

**Layout order (both Workbench's Dice pane and Dashboard's Dice Roller) is
fixed: [Clear (icon-only, red) → dice buttons (grey)] → [expression input +
Roll button] → [Moves buttons (blue), hidden entirely when the System has no
Rolls] → [symbol-pool section, mutually exclusive with everything above].**
Moves are a separate row below the input/Roll button, not mixed into the
quick-dice grid above it — a quick-dice button only edits the expression
string (nothing rolls until Roll is clicked), while a Move button is a
one-click roller in its own right.

**The reserved-key Array field pattern generalizes past dice/Rolls** — a
System's Travel Means (walking pace, horseback, an Eberron airship) use the
identical convention under the key `"travelMeans"`, read by
`extractSystemTravelMeans()` (`common/js/lib/travel-means.js`). A value's
`speedMph`/`hoursPerDay`/`fare` live in its own Extra properties (JSON), same
as a die's `sides`/`color`. A travel-means *value* can also carry
`settingIds` (the same convention Resources use — see below — applied per-
value instead of per-record) so a System can define means that only make
sense in one of its own Settings alongside means that work everywhere it's
used. Consumed today by the Dashboard's Calculator widget
(`common/js/lib/widgets/calculator.js`) — a general-purpose widget built to
host more than one calculator Type over time via its Type select. Travel Time
is also the reference example for NOT hardcoding weather/random-encounter
tables: a single per-widget-instance "Daily macro" config field (e.g.
`dice:[[Encounters#^encounter-table]]`) just rolls whatever GM-authored
rollable Journal table reference or plain expression it's given, once per day
of the computed trip — rather than another reserved System field or hardcoded
JS table. Any future System-scoped-but-optionally-Setting-scoped vocabulary
should reach for this same reserved-key three-part shape (reserved field key
+ Extra-JSON per-value data + optional per-value `settingIds`) before
inventing something new.

### Resource conventions (`common/data/resource/*.json`)

A Resource's payload is freeform JSON (the `resource` kind file declares no
field schema — the real editor is Loom's generic Entity JSON textarea), so
these are conventions, not enforced fields:

- **`price`** — a plain human-readable string (`"20 gp"`, `"1 sp per mile"`,
  `"4d4x10 gp"` for a randomly-priced commodity), not a structured number —
  Sanctum deliberately isn't a ledger, so this is display-only flavor a GM
  reads, not something any code sums or validates.
- **`category`** — a plain descriptive string (`"adventuring-gear"`,
  `"service"`, `"wondrous-item"`) for a human skimming the Resource list.
  Mostly not read by any filter — Resource generation-matching's own
  tag-compatibility check only ever uses `tags.locationTypes`/
  `tags.locationPurposes`/`tags.environments` and the `systemIds`/
  `settingIds` scoping below, the same as every other kind — except that the
  literal value `"service"` IS read by `generator.js`'s Needs picker (see
  `family` below): a shop (the shared starter "commerce" Purpose) never
  Needs a Service, and even outside Commerce a Service is comparatively rare
  as a Need. Every other `category` string is purely descriptive.
- **`house`** — which Eberron Dragonmarked house offers a service Resource
  (`"kundarak"`, `"sivis"`, `"orien"`, ...), purely descriptive, same
  no-code-reads-it status as `category`.
- **`settingIds`** — same convention as `systemIds` (empty/absent = every
  Setting, non-empty = restricted to those) — so an Eberron-specific Resource
  never surfaces when generating a Location under a different Setting.
- **`family`** — unlike the fields above, this one IS read by
  `generator.js`: an optional string tying together Resources that are
  really the same underlying thing at different sizes/grades/variants (e.g.
  every `res.dragonshard-*` file shares `"family": "dragonshard"`, whether
  it's Eberron/Khyber/Siberys or Large/Medium/Small). Generation never lets
  an Asset and a Need share a `family` (in addition to never letting them
  share the exact same id) — a place having "Dragonshards" as a resource and
  also needing "Dragonshards" makes no sense even if the two picks happened
  to be different sizes. Leave unset for a Resource with no real variants;
  two Resources with no `family` are never treated as the same thing just
  for both being unset.

### Location Type conventions (`common/data/location-type/*.json`)

Like Resource, a `location-type` payload is freeform JSON — no field schema
enforces this, it's a convention:

- **`scale`** — an optional number, read by `js/app.js`'s Generate
  Multi-Room Location handler to keep a multi-room result's rooms
  plausible relative to their parent: a room's own Type may only have a
  `scale` **less than or equal to** the parent Location's resolved Type
  scale, never greater (a Structure or Complex can plausibly be "inside" a
  Region, but a Region can't sensibly be "inside" a Complex). The 5 starter
  Types seed two tiers — `region`/`environment` at `2`, `settlement`/
  `complex`/`structure` at `1` — matching the containment language already
  in `region.json`'s/`complex.json`'s own descriptions. A Type with no
  `scale` set is always treated as an eligible child (permissive default —
  a Creator-authored Type that hasn't opted into this convention shouldn't
  silently become unpickable), and the whole constraint is skipped entirely
  when the parent's own resolved Type has no `scale`. Only ever consulted
  for multi-room generation — a single Generate Single Location click has no
  parent to compare against, so `scale` plays no role there. An explicit
  Type override (if the GM pinned one) still applies to every room exactly
  as it did before this convention existed, since the override's own Type
  always trivially satisfies `scale <= scale` against itself.

### Vault's generator-property field detection (`vault/js/lib/tables.js`)

Vault has no hardcoded knowledge of "Rarity"/"Activation"/"Form" as concepts —
`isGeneratorPropertyField` treats any array field on the active System as a
selectable Vault property whenever every one of its values carries a numeric
`cost` or `targetBudget`. That shape-only detection can false-positive on a
field meant for an entirely different mechanism that happens to reuse those
key names — confirmed for `sys.dnd5e.json`'s own `challengeRating` (Crucible's
Combat Scaling levels; each value's `targetBudget` feeds Crucible's own
encounter-difficulty math, nothing to do with spells/items), which used to
leak into Vault's own Identity section as a selectable property purely by
accident. Excluded via `NON_VAULT_PROPERTY_FIELD_KEYS`, a small hardcoded set
of field keys checked first in `isGeneratorPropertyField` — deliberately an
exception in Vault's own code, not a flag stored on the System record: a
System's fields describe the game, not which Undercroft tool may read them.

### Event naming

Some cross-module events use an `undercroft:*` prefix; others a leftover
`workbench:*` prefix from before `DataManager` became suite-wide. **New code
uses `undercroft:*`.** `workbench:*` is legacy — don't extend it, but don't mass
-rename existing listeners either (deliberately out of scope for a single pass).

### DDB-import-specific glue is not a hardcoding violation

`loom/mappings/ddb-character.json`/`ddb-monster.json`, `mapping-custom-
functions.js`, and `common/js/lib/system-lookup-tables.js` are allowed to know
D&D-specific field names and shapes — their entire job is translating D&D
Beyond's wire format into Undercroft's data model, which only ever means D&D 5e.
The actual rule this suite enforces is narrower: the *vocabulary values*
(condition names, alignments, skill lists, ...) must live in and come from the
System record edited in Loom, not be duplicated as static values in JS.

Concretely: `sys.dnd5e.json`'s own fields (`conditions`, `activation`,
`components`, `abilities`, `saves`, `senses`, `sizes`, `skills`, `speeds`, ...)
each carry a `sourceId` (the numeric D&D Beyond code they correspond to) and,
where relevant, a `shortName` — Loom's generic per-value "Source ID"/"Short
name" columns already cover this with no per-field special-casing.
`common/js/lib/system-lookup-tables.js`'s `deriveLookupTables(systemPayload)`
reshapes those fields back into the exact object/array shapes the mapping
engine's `lookup(table, key)` calls expect, so a System missing any of them
just degrades to empty lookups rather than failing outright — this is the
*only* place that has to know "sys.dnd5e's `conditions` field is the old
CONDITIONS table," and it's appropriately-scoped DDB-import glue, not a
reintroduction of hardcoded schema.

### Component Inspector standards (Press/Workbench)

Press and Workbench each render a per-component-type property panel (Press:
static HTML + JS show/hide, `press/js/app.js`'s `updateInspector()`; Workbench:
fully dynamic DOM, `workbench/js/pages/workbench-template-view.js`'s
`render*Inspector` functions). These converged onto Press's original patterns
after they'd drifted apart. The standards below are binding for any new
component type or tool, not just the two that exist today.

- **Exactly two data-population field names exist, never a third.**
  - **"Binding / Text"** — what populates a component from the **Character
    record** (or a plain literal, static value). Also the field written to
    when the user makes a selection. Present on every type that has any data
    concept at all.
  - **"Source / Options"** — what populates a **list of choices** from the
    **System record** (a Select Group's options, a Toggle's states, an Input
    Select's options). Only rendered on the small number of types that
    genuinely have a choices-list concept — every other type never shows it,
    not hidden/disabled, simply absent from that type's inspector.
  - Where both exist, Source / Options is stacked above Binding / Text (it
    feeds the picker; the pick becomes the Binding).
  - The one confirmed exception: a purely *structural* count/config field
    (e.g. Track's "Segments" — a total segment count, not a Character value or
    a System choice-list) keeps its own specific name rather than being
    force-fit into either bucket.

- **Standard section order, both tools, every component type:**
  1. **Type Summary** — icon + type label + description + an "In [parent]"
     breadcrumb when nested (never collapsible).
  2. **Identity** — ID, Label/Name (never collapsible, always expanded).
  3. **Component** — the type's own unique fields, including Binding / Text
     and (only where applicable) Source / Options (never collapsible, always
     expanded — it's why the inspector was opened). There is no separate
     generic "Data" section — merging it into this section is what resolved a
     real, confusing bug where a type's own component-specific binding field
     and a generic, identically-labeled Data-section field for a *different*
     concept (e.g. Track's segment count vs. its current fill value) were
     indistinguishable.
  4. **Appearance** — Colors, Borders, Font/Text formatting, Alignment,
     Spacing.
  5. **Behavior** — Visible, Collapsible, Locked.
  6. **Advanced** — Classes, Aria label.
  - Sections 4-6 default **collapsed**, auto-forced open if the component's
    current values for that section's fields differ from a pristine default
    instance of the same type.

- **The unified toggle/formula control** (`createFormulaToggleField`,
  `common/js/lib/inspector-fields.js`) is the one control for every boolean
  property that plausibly varies **by character** — currently Visible,
  Collapsible, Locked, and (Workbench-only, no Press equivalent) Editable in
  Play. Both tools use this exact same control for Visible. A manual click
  flips the plain boolean when the adjacent binding/formula field is empty;
  typing a `@binding`/`=formula` into that field live-evaluates it (an
  injected `evaluate(raw)` callback — each tool supplies its own resolver
  against whatever sample/live data it has) and disables manual clicking
  while content is present — a formula, when present, always wins over
  manual control. `evaluate` returning `undefined` (a case that genuinely
  can't be previewed, e.g. Workbench's Template editor never evaluates
  `=formula` expressions, only bindings, since there's no live record) shows
  as the toggle's native indeterminate state rather than guessing true/false.
  - **Not every switch qualifies.** Purely structural/authoring-time choices
    with no plausible per-character variation (Repeater's "Header row/column",
    "Fill available width") stay plain switches (`createSwitchField`).
  - **Mounted once, re-synced from the outside, for tools with static DOM.**
    Workbench's Template editor rebuilds the field fresh on every selection
    change; Press mounts each inspector field once at load time and pushes
    new state into the same persistent DOM on selection change instead
    (`updateInspector()`) — for that pattern, the returned field also exposes
    `.switchInput`/`.bindingInput` (the raw elements) and
    `.syncToggleState({checked, bindingValue})` (pushes a different record's
    state in from the outside, bypassing the change/input listeners).

- **One shared field-shape kit.** `createFormFloatingField`/
  `createButtonCheckGroup`/`createCheckField` (`common/js/lib/ui-components.js`
  — generic enough that non-inspector callers use them too) cover every plain
  text/number/select/textarea field and every segmented button-group (radio
  *or* checkbox selection). `common/js/lib/inspector-fields.js` re-exports all
  three so an inspector only ever needs one import source, and adds the
  inspector-specific layer on top: `createFieldRow`, `createHalfWidthNumberField`,
  `createSwitchField`, `createFormulaToggleField`, `createCollapsibleSection`,
  `createTypeSummaryHeader`. **New inspector fields are built from this kit** —
  a new hand-rolled label+input pair, or a second button-group implementation,
  is exactly the kind of duplication this suite avoids. Segmented button
  groups default to a single row (buttons shrink to fit, never wrap) and
  full-size buttons — pass `wrap: true` for the rare group that should wrap
  instead, or `size: "sm"` for smaller buttons.

- **One shared icon registry**, `common/js/lib/component-icons.js` —
  `COMPONENT_ICONS`, the single source of truth for "what icon represents this
  component type," re-exported by `workbench/js/lib/component-styles.js` and
  imported directly by Press's `paletteComponents`. A concept that exists in
  both tools (Icon, Text, Image, Repeater) uses the *same* icon in both.

### Loom: adding a new authoring surface

Loom's tabs (`data-loom-view-tab`/`data-loom-view-panel` in `loom/index.html`,
switched by `setLoomView()` in `loom/js/app.js`) split into two fundamentally
different roles, and a new Library kind's editor must pick the right one
rather than blending them:

- **The Library tab is the generic, kind-agnostic editor** — one Id field,
  one raw JSON textarea (`libraryJsonTextarea`), plus exactly two
  already-established cross-reference helpers that apply to *any* kind
  (Assigned Systems checkboxes, Assigned Template select). **It never grows a
  section that only appears for one specific kind.** If a kind needs
  structured, non-JSON editing of its own data shape, that is a signal to add
  a new tab, not a signal to special-case the Library tab.
- **A dedicated tab is the authoring surface for a kind with its own
  structured shape** — the Systems tab is the canonical template: a
  left-pane select of existing records driving a main-pane card with
  Id/Title/... fields plus a structured sub-editor (Properties'
  array-of-typed-rows), its own New/Save/Delete toolbar buttons scoped to
  that tab, its own undo/dirty-tracking entry, and (optional, only where a
  row benefits from a second, larger editing surface) a right-pane Inspector.
  The tier gate on a tab controls who *sees the tab*; it does not change
  which kind's *data* is being edited — the same kind is still reachable, as
  raw JSON, from the generic Library tab too.
- A kind only needs a dedicated tab once its shape is complex enough to
  benefit from typed fields/pickers over raw JSON. A kind with a flat, simple
  shape has no reason to leave the generic Library tab at all — don't build a
  tab just for symmetry.

---

## Architecture Reference

How the moving pieces fit together, for anyone maintaining, extending, or
troubleshooting the suite: the shared front-end architecture, Workbench's
unified editor page, the contextual help system, and the Python server stack.

### Front-end architecture

**App shell & layout.** All pages share a structural shell initialized
through `initAppShell` (`common/js/lib/app-shell.js`), which wires up theme
toggles, pane controls, a status manager, keyboard shortcuts, and a persisted
undo/redo stack per namespace. Each HTML entry point reuses the same
three-pane layout (left tools, center canvas, right utilities) and binds pane
toggles via data attributes consumed by the shell utilities (see UI & Style
Conventions above for the full shell-building mechanism). Undo history is
stored in `localStorage` namespaced by tool, so reloading restores the latest
draft even offline.

**Theme management.** `initThemeControls` (`common/js/lib/theme.js`) reads
and persists the theme preference, applies CSS custom properties on both
`<html>` and `<body>`, and keeps buttons in sync with `prefers-color-scheme`
changes. Every HTML page includes the same bootstrapping inline `<script>` in
its `<head>` to apply the stored theme before first paint, avoiding a flash
of the wrong theme.

**Data management & offline cache.** `DataManager`
(`common/js/lib/data-manager.js`) abstracts REST calls, session persistence,
and local caching for every Library kind. It normalizes tiers, scopes cache
entries by the authenticated user, mirrors remote saves into local storage,
and exposes list/save/delete helpers used across every tool. Tier
requirements for write operations are enforced client-side before hitting the
API, matching the server-side kind-registry checks.

**Access control.** Tier gating is handled by `initTierVisibility` and
`initTierGate` (`common/js/lib/access.js`), which read the current session,
hide gated content until permissions resolve, and provide callbacks when a
user's tier changes so pages can react. It's a shared cross-tool utility —
Loom uses `initTierGate` to gate the entire tool behind a minimum tier, while
most other tools use `initTierVisibility` for per-element/per-tab gating.
`data-requires-tier`/`data-access-label` attributes toggle automatically once
`DataManager` resolves the user's role.

**Contextual help system.** Help topics live in `common/data/help-topics.json`
and are loaded once via `loadHelpTopics` (`common/js/lib/help.js`), which
caches the parsed catalog and normalizes metadata, titles, and category
groupings. `initHelpSystem` scans for elements tagged with `data-help-topic`,
injects a tooltip-enabled "?" button, and links to the account page's help
browser (the one destination guaranteed to exist and work from every tool —
a topic's own stored `href` is not used for this, see `help.js`'s own
comment for why). `common/docs.html` is a second, full-page view over the
same JSON catalog for browsing every topic at once.

### Tool implementations

**System Editor.** System authoring lives entirely in Loom's Systems tab —
there is no separate System-editing surface in Workbench. Loom edits the
`system` Library kind via a plain list-editor for Properties
(`renderSystemPropertyRow`/`collectSystemProperties` in `loom/js/app.js`)
rather than a drag-and-drop canvas. Properties can be nested — an `object`
property has its own Sub-fields list, and an `array` property is either Enum
(a flat, System-defined value list shared by every record) or Records (a
recursive sub-field list plus a Display field, describing each record's
shape rather than its values) — matching the nested shape Template's binding
picker (`collectSystemFields` in `common/js/lib/system-schema.js`) expects. A
Preview Data JSON field covers the system-wide sample-data block Template
uses for canvas previews.

**Unified editor page (Template / Play / Edit views).** Workbench is a single
page (`index.html`) with a Template/Play/Edit tab switcher instead of
separate pages per view. `js/pages/workbench.js` is the orchestrator: it owns
the single `initAppShell` call (one shared status/undo stack across every
view), DataManager, auth, help system, and tier gating (Template is gated to
GM+ on its tab button), and dispatches undo/redo entries to whichever view
owns that entry's `type`. Play view defaults on load; `?view=template|play|edit`
and `?record=<bucket>:<id>&share=<token>` deep-links both pick the initial
view.

The Template Builder and Character Sheet logic live in
`js/pages/workbench-template-view.js`/`workbench-character-view.js`, each
exporting an `initTemplateView(deps)`/`initCharacterView(deps)` function
(taking the shared `status`/`undoStack`/`dataManager`) and returning a small
hook object (`applyUndoEntry`, `applyRedoEntry`, `hasUnsavedChanges`,
`markClean`, and for the character view, `setMode`) that `workbench.js` calls
into. The two views' rendering engines are deliberately **not** unified —
Template's canvas-preview renderer and Character's live-binding renderer
remain independent implementations of the same component-type vocabulary.

*Template view* exposes a component palette (`COMPONENT_ICONS`) bound to
dropzone handlers, hydrates system schemas for binding pickers, and manages
undoable canvas mutations through shared root-insertion helpers.

*Play / Edit views* load DataManager session state and orchestrate template,
system, and character catalogs. Edit view is dirty-gated like Template view
and Loom, via an explicit Save button and `hasUnsavedCharacterChanges()`
(it does not autosave on every keystroke) — leaving Edit mode still
force-persists as a safety net. Dice rollers and formulas reuse the shared
dice and formula engines, logging results to the game log pane. Collaboration
tooling integrates share links, group membership, and live game log polling
through DataManager and the server APIs.

### Server architecture

**HTTP server & routing.** `server/app.py` defines a threading HTTP server
that wraps a shared `Router` and falls back to static file serving for
unknown routes. Routes handle health checks, bucket listing, content CRUD,
builtin catalog delivery, ownership queries, sharing, and group management.
Each handler extracts URL params, enforces authentication with `AuthError`,
and serializes JSON responses with consistent status codes. Static file
requests route through `serve_from_root`, letting the app serve its own UI
with no separate web server needed.

**Authentication & sessions.** `auth.py` encapsulates session persistence,
password hashing, email/password updates, tier upgrades, and default user
seeding. Helper functions expose login, logout, registration, verification,
and lookup by username or session token. `cleanup_sessions` prunes expired
tokens, while `ensure_default_admin` keeps a demo admin account available in
development. The request handler resolves the session token to a user via
`get_user_by_session`, which gates every downstream handler that needs one.

**Storage layer.** `storage.py` initializes the SQLite schema — the unified
`library_items` ownership/sharing index every Library kind shares (see "The
Library" above), plus the genuinely relational tables (`shares`,
`share_links`, `group_members`, `group_logs`) and auth tables (`users`,
`sessions`). A kind's actual document content lives as a flat JSON file on
disk (`common/data/<kind>/<id>.json`), not in the database — `library_items`
only indexes ownership/title/metadata for it. File-locking utilities guard
JSON payload writes across platforms so saves stay atomic under concurrency.
Storage helpers enforce ownership, update metadata timestamps, list bucket
contents, and raise `AuthError` when non-owners attempt restricted
operations. Share tokens are resolved and touched on access.

**Shares & groups.** `shares.py` encapsulates share-link CRUD, unique token
generation, and listing shareable users by tier while preventing duplicate
relationships. `groups.py` provides CRUD for Campaign Groups, member
assignments, and the group game logs that back the live-session collaboration
features described earlier in this document. Both modules rely on the same
tier/ownership checks as everything else, enforced via the shared
`ensure_share_permission`-style checks in `app.py`.

**Configuration & runtime state.** `config.py` loads `server.config.json`,
exposing options such as ports, database path, and CORS origin, while
`state.py` centralizes shared resources (config loader, the DB connections,
caches, locks) passed into every request handler. Static asset serving
honors the configured project root via `static.py`, so updating client
assets requires no server code changes.

### Workflows & data flows

**Built-in content.** `content-registry.js` reconciles local caches with
builtin definitions, verifying assets, surfacing missing-content badges, and
seeding demo content for systems/templates/characters used across every
tool. UI badges (e.g. "Requires Creator") update automatically via the
access module once `DataManager` resolves tier info.

**Import/export & JSON previews.** Every editor exposes import/export
buttons bound to shared helpers. `json-preview.js` renders JSON snapshots
into the right pane; toolbar buttons call into DataManager save operations
or download raw payloads via shared downloader utilities. External content
(e.g. D&D Beyond) comes in through Loom's **mapping system**
(`loom/mappings/*.json` + `mapping-engine.js`'s `applyMapping`) — a
standalone, GM-authored transform from an external wire format into
Undercroft's own data model, reused by the DDB character-import pipeline and
Workbench's own player-facing "Import Character" flow alike. This is the
suite's one working import mechanism; there is no other importer concept.

**Inventory data modeling — schema done, rendering still roadmap.** Complex
inventories (an equipment table with name, quantity, weight, notes) need more
structure than a flat field list.
- **Done, authored in Loom today**: `array` fields carry an `item` contract
  mirroring `object` children (e.g. `{ type: "array", key: "inventory", item:
  { type: "object", displayField: "inventory[].name", children: [...] } }`) —
  an object property gets a recursive Sub-fields list, an array property is
  either Enum or Records (its own recursive Sub-fields list plus a Display
  field). `collectSystemFields` already surfaces child paths like
  `inventory[].quantity` so formulas/bindings understand nested arrays.
- **Not yet built**: the Template editor doesn't yet render List components
  directly from this schema metadata (a column designer pre-filled from the
  System's own `item` contract, calculated/formula-backed columns, multiple
  presentation variants). The character runtime still edits `array`
  components via a raw JSON textarea rather than a purpose-built collection
  editor with add/remove controls, per-column type validation, and
  aggregation helpers (e.g. `=sum(@inventory[].quantity)` for a total-weight
  field).

**Collaboration.** Share-management flows call the shares/groups endpoints
described above, enforcing tier checks server-side. Group game logs persist
via the group-log routes and surface in Workbench's Play view, which polls
for new entries and merges them with local drafts. Help topics anchored to
game-log headers and character selectors explain these flows directly in the
UI.

### Error handling & diagnostics

Client modules throw descriptive `Error` instances when required
dependencies (fetch, storage) are missing, so failures in an unsupported
environment surface early rather than silently. Server handlers catch
`AuthError`/`StorageAuthError` and translate them into HTTP 401/403
responses; unexpected exceptions log stack traces and return 500s. Status
toasts surfaced through the shared `StatusManager` give immediate feedback on
undo/redo, saves, and other actions for every tool. Combined with the
contextual help system, there's one consistent place to diagnose issues and
learn workflows regardless of which tool you're in.

---

## Adding a New System

A practical checklist, distilled from actually adding a second real System
(Blades in the Dark — dice-pool resolution, no HP/AC/spellcasting, no DDB
import source) alongside D&D 5e to stress-test that the suite really is
system-agnostic.

**What a System needs at minimum**: an id, a title, and a `fields` array —
that's it. Every "System-shaped" capability elsewhere in the suite
(generator-property fields for Vault's Rarity/Activation/Item Form, Crucible's
Creature Type/Combat Scaling, Sanctum's Environment, dice/Rolls, Travel
Means) reads its own reserved-key field off that array **only if present** —
absent means "nothing eligible," never an error. A new System doesn't need to
declare any of these unless the game actually has that concept:

- No ability scores/HP/AC/spellcasting? Skip `combatBindings`,
  `creatureTypes`, `combatScaling` entirely.
- No magic-item/spell economy? Skip the generator-property fields Vault reads
  (`getSystemPropertyTypes` returns `[]` for a System with none — no crash,
  no special-casing needed).
- Combat Scaling/Creature Type field names default to the conventional
  `combatScaling`/`creatureTypes` and are absent-safe the same way — only
  worth setting a different field name via Crucible's own Settings if a
  System's own vocabulary collides with those defaults.
- Want a die-pool or non-standard dice? Add a `"dice"`-keyed Enum array field
  (see Code Conventions above) — as narrow or wide as the game actually needs
  (Blades needed exactly one die, a d6 with a `faceMap` relabeling 1-6 into
  its own 1-3/4-5/6 result bands).
- Want currency with a physical weight, for the Inventory Weight calculator?
  Add a `weight` value to the System's `currency` array field — absent means
  that calculator simply doesn't factor currency weight in for this System,
  not an error.

**Character data is hand-authored, not imported, for any System without a
DDB-style import mapping** — that's a fully supported, exercised path (Play/
Edit mode), not a fallback.

**The one real gotcha, worth remembering for any future System**: a
component's `binding` (writes to/reads from the character) and
`sourceBinding` (reads a choice list from the System) must never share the
same key name. `resolveSourceBindingValue` checks several contexts in
priority order, and the live character's own draft data wins before the
System's own lookup list does — so if both use the same key, the moment a
character gets a real value for it, the Source lookup starts resolving to
*that value* instead of the System's list, silently collapsing the dropdown
to empty. This isn't validated or warned about anywhere in the editor — it
fails silently and only shows up once a real value is set. The fix is
always the same: give the System-side lookup field a distinct (usually
plural) name from the character-side field it populates — `heritages` vs.
`heritage`, `backgrounds` vs. `background`, `playbooks` vs. `playbook`, and
so on.

Other patterns worth knowing going in, all pre-existing capability, nothing
special-cased per-System:
- **Computed fields** are just Text components with a `=sum(...)`/other
  formula binding, not stored values.
- **Rated/dot-style tracks** (a count of filled segments) are a Track
  component (linear or circular shape, matching whatever visual language the
  game itself uses), not a Toggle — Toggle is for a single named state, not a
  count.
- **A single static checkbox** (no true bare-boolean input exists) is an
  Input(checkbox) with one static `options: ["Label"]` entry, giving
  `["Label"]`/`[]` rather than `true`/`false` — fine functionally, just worth
  knowing before assuming a plain boolean field renders anything on its own.
- **Per-branch content without dynamic Source filtering** (e.g. one set of
  abilities per character sub-type) is a Tabs Container, one tab per branch,
  each holding that branch's own content directly — no "filter a choice list
  by another field's value" capability is needed for this shape.
- **A brand-new System/Template/Character file placed directly on disk (not
  saved through the app) needs no server restart** — the server self-heals a
  missing ownership-index row for it on the very next read or list, gated on
  the kind's own directory mtime so this stays cheap on every other request.
