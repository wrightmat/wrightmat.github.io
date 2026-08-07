# Undercroft Suite Code Conventions

Behavioral/architectural conventions in JS and Python, confirmed by a full-project
audit (see `common/docs/code-audit.md` for the findings that led here) rather
than invented fresh. Sibling to `style-guide.md`, which stays scoped to
visual/CSS conventions.

## Process: before adding new suite UI

This section exists because "the conventions were already written down" has
failed in practice — a real 2026-08 Loom Macro-authoring feature matched an
existing pattern's *widget shape* (a row-editor for an array of typed items,
copying System's Properties editor) but missed its *architectural placement*
(System's row editor lives in Systems' own top-level tab; the new code bolted
an equivalent editor onto the generic Library tab's raw-JSON view instead,
which every kind shares and which is supposed to stay JSON-only). The fix
that session was mechanical, not a vague "be more careful": pulling the two
questions below apart, because matching one without the other is exactly how
this kind of drift gets past a normal review.

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

If the honest answer is "this genuinely needs to diverge from the
precedent," say so explicitly and state why — don't bury the exception
inside the implementation (see `feedback_dont_unilaterally_scope_exceptions`
memory). See `feedback_suite_wide_parity_principle` memory for why this
matters at the suite level generally, and the "Loom: adding a new authoring
surface" section below for the concrete rule this specific failure produced.

## Server (`server/`)

- **Single-lock discipline**: hold `state.lock` only around the actual DB touch,
  never across I/O or `sleep`. Long-running work (LLM calls, DDB proxy fetches)
  happens outside the lock.
- **POST-only delete**: every delete route is a POST, never a bare DELETE verb
  with no body — keeps CSRF/confirmation handling uniform across kinds.
- **Tier checks always via `role_rank()` compare**, never a direct string
  equality against a tier name — ranks handle the free < player < gm < creator <
  admin ordering correctly; string equality doesn't compose with "at least this
  tier" checks.
- **Kind normalization once, at the route boundary** — routes normalize the
  `kind` path segment on entry; nothing downstream re-normalizes it.

## Shared JS layer (`common/js/lib/`)

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

## Event naming

Some cross-module events use an `undercroft:*` prefix; others a leftover
`workbench:*` prefix from before `DataManager` became suite-wide. **New code
uses `undercroft:*`.** `workbench:*` is legacy — don't extend it, but don't mass
-rename existing listeners either (out of scope for a single pass).

## DDB-import-specific glue is not a hardcoding violation

`loom/mappings/ddb-character.json`/`ddb-monster.json`, `mapping-custom-
functions.js`, and `common/js/lib/system-lookup-tables.js` are allowed to know
D&D-specific field names and shapes — their entire job is translating D&D
Beyond's wire format into Undercroft's data model, which only ever means D&D 5e.
The actual rule this suite enforces is narrower: the *vocabulary values*
(condition names, alignments, skill lists, ...) must live in and come from the
System record edited in Loom, not be duplicated as static values in JS. See
`common/docs/lookup-tables-migration.md` for the concrete example.

## Component Inspector standards (Press/Workbench)

Press and Workbench each render a per-component-type property panel (Press:
static HTML + JS show/hide, `press/js/app.js`'s `updateInspector()`; Workbench:
fully dynamic DOM, `workbench/js/pages/workbench-template-view.js`'s
`render*Inspector` functions). These converged onto Press's original patterns
after they'd drifted apart — Workbench alone had accumulated ~8 near-duplicate
"labeled field" builders and inconsistent naming for the same underlying
concept across component types. The standards below are the result; treat them
as binding for any new component type or tool, not just the two that exist
today.

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
  - See `project_binding_text_vs_source` memory for the full rationale and
    per-type mapping.

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
    instance of the same type (Workbench: compares against a throwaway
    `createComponent(type)`, counter-safe — see `hasNonDefaultValues` in
    `workbench-template-view.js`).

- **The unified toggle/formula control** (`createFormulaToggleField`,
  `common/js/lib/inspector-fields.js`) is the one control for every boolean
  property that plausibly varies **by character** — currently Visible,
  Collapsible, Locked (renamed from "Read only" — storage key intentionally
  unchanged to avoid a wider migration, see the field's own comment in
  `workbench-template-view.js`), and (Workbench-only, no Press equivalent)
  Editable in Play. Both tools now use this exact same control for Visible —
  Press's own `visibleWhen` storage already supported both `@binding` and
  `=formula` syntax in one field before this control existed; only the
  control's *shape* changed to match Workbench's, not Press's data model. A
  manual click flips the plain boolean when the adjacent binding/formula
  field is empty; typing a `@binding`/`=formula` into that field
  live-evaluates it (an injected `evaluate(raw)` callback — each tool
  supplies its own resolver against whatever sample/live data it has) and
  disables manual clicking while content is present — mirroring the
  pre-existing `componentHasFormula()`/`isEditable()` precedent that a
  formula, when present, always wins over manual control. `evaluate`
  returning `undefined` (a case that genuinely can't be previewed, e.g.
  Workbench's Template editor never evaluates `=formula` expressions, only
  bindings, since there's no live record) shows as the toggle's native
  indeterminate state rather than guessing true/false — Press's own resolver
  always returns a real boolean for non-empty input instead, since Press
  always has a concrete `getSampleData()` record to evaluate a formula
  against.
  - **Not every switch qualifies.** Purely structural/authoring-time choices
    with no plausible per-character variation (Repeater's "Header row/column",
    "Fill available width") stay plain switches
    (`createSwitchField`) — adding formula capability to a field nobody would
    ever drive by character data is not the goal.
  - **Mounted once, re-synced from the outside, for tools with static DOM.**
    Workbench's Template editor rebuilds the field fresh (new `checked`/
    `bindingValue`) on every selection change, so it never needs anything
    beyond the plain returned node. Press mounts each inspector field once at
    load time and pushes new state into the same persistent DOM on selection
    change instead (`updateInspector()`) — for that pattern, the returned
    field also exposes `.switchInput`/`.bindingInput` (the raw elements, for
    wiring anything the constructor callbacks don't cover — e.g. Press's
    pending-undo focus/blur listeners) and `.syncToggleState({checked,
    bindingValue})` (pushes a different record's state in from the outside,
    bypassing the change/input listeners — this is a resync, not a user
    edit).

- **One shared field-shape kit.** `createFormFloatingField`/
  `createButtonCheckGroup`/`createCheckField` (`common/js/lib/ui-components.js`
  — generic enough that non-inspector callers use them too, not
  inspector-specific) cover every plain text/number/select/textarea field and
  every segmented button-group (radio *or* checkbox selection — same
  function, `inputType` picks which). `common/js/lib/inspector-fields.js`
  re-exports all three so an inspector only ever needs one import source, and
  adds the inspector-specific layer on top: `createFieldRow` (compact
  `row g-2`/`col-*` or flex-wrap N-up layout for short/numeric field pairs —
  selects, textareas, and button groups stay full-width),
  `createHalfWidthNumberField`, `createSwitchField`, `createFormulaToggleField`,
  `createCollapsibleSection`, `createTypeSummaryHeader`. **New inspector
  fields are built from this kit — a new hand-rolled label+input pair, or a
  second button-group implementation, is exactly the kind of duplication
  this pass eliminated and the suite-wide parity principle
  (`feedback_suite_wide_parity_principle` memory) forbids.** Segmented button
  groups default to a single row (buttons shrink to fit, never wrap) and
  full-size buttons — pass `wrap: true` for the rare group that should wrap
  instead, or `size: "sm"` for smaller buttons; don't reach for a bespoke
  `btn-group` when the function that already exists does the same job.

- **One shared icon registry**, `common/js/lib/component-icons.js` —
  `COMPONENT_ICONS`, the single source of truth for "what icon represents this
  component type," re-exported by `workbench/js/lib/component-styles.js` and
  imported directly by Press's `paletteComponents`. A concept that exists in
  both tools (Icon, Text, Image, Repeater) uses the *same* icon in both; a new
  shared concept added to either tool should be registered here, not
  hardcoded locally. Workbench's own palette markup
  (`workbench/index.html`) syncs its `data-icon` attributes from this
  registry at init time rather than duplicating the values by hand.

## Loom: adding a new authoring surface

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
  left-pane select of existing records (`data-system-select`) driving a
  main-pane card with Id/Title/... fields plus a structured sub-editor
  (Properties' array-of-typed-rows), its own New/Save/Delete toolbar buttons
  scoped to that tab (`data-loom-view-panel="systems"`), its own
  `SNAPSHOT_HANDLERS`/`cleanSnapshots` entry for undo + dirty-tracking, and
  (optional, only where a row benefits from a second, larger editing
  surface) a right-pane Inspector. `LOOM_CREATOR_TABS` gates which tier sees
  the tab; it does not change which kind's *data* is being edited — the same
  kind is still reachable, as raw JSON, from the generic Library tab too.
  The Macros tab (`data-macro-*`, added 2026-08) is the second confirmed
  instance of this template after Systems — copy its structure (or
  Systems') for the next one rather than re-deriving it.
- A kind only needs a dedicated tab once its shape is complex enough to
  benefit from typed fields/pickers over raw JSON (Systems' nested Property
  tree, Macros' typed action rows). A kind with a flat, simple shape has no
  reason to leave the generic Library tab at all — don't build a tab just
  for symmetry.
