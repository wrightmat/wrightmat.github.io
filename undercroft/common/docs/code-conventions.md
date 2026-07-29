# Undercroft Suite Code Conventions

Behavioral/architectural conventions in JS and Python, confirmed by a full-project
audit (see `common/docs/code-audit.md` for the findings that led here) rather
than invented fresh. Sibling to `style-guide.md`, which stays scoped to
visual/CSS conventions.

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
