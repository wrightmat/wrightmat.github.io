# Code audit: redundancy, dead code, optimization, hardcoded values

A point-in-time snapshot from a full-project pass (server/, common/js/lib/,
every tool's own js/app.js + js/lib/* + js/pages/*). Written to make a second
cleanup pass easy: each item is either **fixed** (this pass), **logged** (real,
but deliberately not attempted here — with the reason why), or **justified**
(looks hardcoded but isn't a violation worth removing). Re-grep the citations
before acting on anything here — code moves.

## Redundancy

### Owner-or-admin delete-permission check (biggest win — fixed)

The same "can this user delete this record" rule — admin bypasses everything;
otherwise check a per-kind ownership/permissions catalog fetched separately —
was hand-written **7 times**, each commenting that it copies one of the others:

- `loom/js/app.js:2289` `systemAllowsDelete(id)` (+ `refreshSystemsCatalog`)
- `loom/js/app.js:2341` `libraryEntryAllowsDelete(kind, id)` (+ `refreshLibraryEntryCatalog`)
- `sanctum/js/app.js:234` `settingAllowsDelete(id)`
- `sanctum/js/app.js:344` `locationAllowsDelete(id)`
- `orrery/js/app.js:250` `mapAllowsDelete(id)`
- `press/js/app.js:1443` `templateAllowsDelete(template)` (operates on an
  already-fetched object, not a catalog `Map` — the one real shape difference)
- `workbench/js/pages/workbench-template-view.js:1644` `templateOwnerMatchesCurrentUser(metadata)`

Fixed: consolidated into `common/js/lib/ownership.js` (`refreshOwnershipCatalog`,
`allowsDelete`). Systems' extra `"builtin"`/`"local"` ownership states (not
present in the plain owner/edit-permission model the other 6 use) are handled
via an options flag rather than forking the logic.

### Four near-identical LLM "generate note" handlers (fixed)

`server/app.py` had four ~80-line route handlers (Forge/Crucible/Vault/Sanctum)
differing only in system prompt and which request-body fields they pulled.
Replaced with one `_handle_generate_note(request, *, kind, system_prompt,
build_user_content)` helper.

### Forge/Vault missing Crucible's dirty-gating fix (real bug — fixed)

Crucible's Save button disables once there's nothing new to save
(`buildRecordForSave`/`isRecordDirty`/`lastSavedSnapshot`). Forge and Vault never
got this — their Save buttons stayed enabled indefinitely, including immediately
after a successful save. Extracted into a shared `createDirtyGate({
buildSnapshot })` helper; Crucible, Forge, and Vault all use it now. Sanctum's
own (more complex, ownership-aware, dual-record) version was left alone — it
does a genuinely harder job than one-shot generate-and-save.

### Small duplicated helpers (fixed)

- `el(tag, className, text)` DOM-builder, byte-identical in
  `common/js/lib/widgets/character-summary.js:17`, `combat-tracker.js:144`,
  `game-log.js:48`, `now-showing.js:27`, and `dashboard.js:181` — promoted to
  `common/js/lib/dom.js`.
- `disableForm(form, disabled)` in `common/account.js:775`,
  `common/js/lib/auth-ui.js:113`, `common/js/lib/share-modal.js:110` — same fix.
- `escapeHtml(value)` privately defined in `common/js/lib/auth-ui.js:128` and
  separately re-implemented in `forge/js/app.js:123`, `loom/js/app.js:104`,
  `sanctum/js/app.js:134`, `workbench/js/lib/dice.js:35`,
  `workbench/js/pages/workbench-character-view.js:104` — `auth-ui.js`'s copy
  exported, the other 5 now import it.
- `LINK_ONLY_KINDS` defined independently in `common/js/lib/spotlight.js:62` and
  `common/js/lib/widgets/now-showing.js:17` (the latter's own comment already
  says it mirrors the former) — `now-showing.js` now imports spotlight.js's.
- `auth-ui.js`'s own `formatTierLabel` (`auth-ui.js:122`, capitalize-only) vs.
  `data-manager.js`'s real one (`data-manager.js:35`, maps `gm`→`"GM"` via
  `ROLE_LABELS`, exposed as `describeTier()`) — this was a **live bug**: a GM's
  account dropdown read "Tier: Gm" instead of "Tier: GM". Fixed by calling
  `dataManager.describeTier()` at the one call site (`auth-ui.js:269`) and
  deleting the local copy.

### Phase 2: the deferred items (fixed)

Everything below was logged in phase 1 as deferred — higher risk or larger
blast radius, deliberately not attempted same-day. A follow-up pass (with a
fresh re-verification against the current codebase, since file:line citations
drift) addressed all of it.

- **Three dotted-path resolvers** (`formula-engine.js`, `bindings.js`,
  `mapping-custom-functions.js`) — the walk mechanics were already
  behaviorally identical everywhere; the real difference was one layer up
  (`formula-engine.js` coerces a missing path to `0`, `bindings.js` doesn't,
  correctly — a resolved binding can be a string/array/boolean). Consolidated
  the mechanics into `common/js/lib/dotted-path.js#resolveDottedPath`, kept
  each caller's own coercion behavior as-is, and commented both call sites
  explaining why they diverge.
- **D&D-5e ability-modifier formula**, 3× duplicated — moved to
  `common/js/lib/dnd-rules.js#abilityModifier`; Crucible's `stats.js` and
  Forge's `tables.js`/`app.js` (`abilityModifierText`, now a thin wrapper)
  import it.
- **Generator tools' shared functions** — `findById`/`featureLabel`/
  `readLockedFeatureIds`/`handleExport`/`listAllSystems`, confirmed
  byte-identical (or equivalent) across Crucible/Vault/Sanctum, moved to
  `common/js/lib/generator-kit.js` (Forge doesn't participate — no
  feature/recipe concept, and its own `listAllSystems` genuinely differs by
  merging in `dataManager.listBuiltins()`). `handleGenerateNote` wasn't a safe
  blind lift (each tool's request body differs) — given a config-object shape
  instead, `generateNoteForRecord({ record, elements, status, generateNote,
  buildRequestBody })`, so the shared spinner/error/write-back plumbing is one
  copy while each tool supplies its own request-body closure.
- **Owner-or-admin `confirm()`-before-delete**, 16 real call sites (not the
  original "9+" estimate) — added `confirmDelete({ label })` to
  `ownership.js`, adopted at 14 of them. Two were deliberately left as their
  own custom `confirm()` calls because their wording carries safety-critical
  information a uniform template would lose: Loom's user-delete (a
  self-delete gets "this will immediately end your session," not the generic
  message) and Press's font-library delete (a shared global resource —
  "removes it for everyone").
- **Tier/role tables**, `data-manager.js` vs `account.js` — not just a casing
  mismatch: `account.js`'s `OWNER_ROLE_REQUIREMENTS.character` excluded
  `free`, while `data-manager.js`'s `WRITE_ROLE_REQUIREMENTS.characters` and
  `character.json`'s own `writeTier` both already agreed free tier can
  write/own a character — a real, live bug (confirmed with the user: free tier
  should be able to own characters). Fixed by deriving `account.js`'s
  `tierMeetsOwnerRequirement` directly from `data-manager.js`'s
  `WRITE_ROLE_REQUIREMENTS`/`ROLE_ORDER`/`roleRank` (all three now exported)
  instead of keeping a second hand-maintained table — `OWNER_ROLE_REQUIREMENTS`
  and the redundant `ROLE_RANKS` (a third copy of `ROLE_ORDER`) are gone.

## Dead code

### Confirmed zero references anywhere in the tree (deleted)

- `common/js/lib/loading-select.js` (whole file)
- `common/js/lib/formula-engine.js`'s `extractDependencies`
- `DataManager.canSyncToServer` / `setBaseUrl` / `getGroupShareLink` / `promote`
- `crucible/js/lib/generator.js`'s `rerollMonster`
- `vault/js/lib/generator.js`'s `rerollEffect` (modeled on the former, also dead)
- `workbench/js/lib/dropdown.js`'s `populateDataList`
- `common/ddb-parser.js` (whole file) — the "hand-written parser" `lookup-
  tables.js`'s header refers to. Confirmed zero imports/script-tags anywhere;
  fully superseded by the mapping-engine + `loom/mappings/ddb-*.json` +
  `mapping-custom-functions.js` pipeline (see the lookup-tables.js migration
  below — those files' comments confirm the port was "near-verbatim," not a
  rewrite, so nothing was lost).
- Server: `server/auth.py`'s `require_role`, `server/storage.py`'s
  `list_static`, and a duplicate `require_user`/`require_authenticated_user`
  pair collapsed to one.

### Resolved in phase 2

- `server/importer.py` — confirmed 100% dead (its one dependency, a
  `"systems"` file mount, doesn't exist in `server.config.json`, so
  `run_importer` threw on every call; zero client-side callers anywhere).
  Decision made with the user: deleted outright, along with the
  `/import/{system}/{importer}` route registration in `server/app.py`.
- `server/builtins.py`'s empty-catalog scaffolding — re-investigated, turned
  out **not** to be a decision point: it's live (routed, actively called by
  Forge's `listAllSystems` via `dataManager.listBuiltins()`) and intentionally
  empty per its own comment (prior builtin entries migrated to real DB-backed
  Library items; left empty rather than removed so a future genuinely-bundled
  starter asset has somewhere to register). No action needed.

## Optimization opportunities (non-behavior-changing)

- Combat-tracker's conditions/combatBindings loaders each independently fetched
  the same System record — fixed to one fetch, both derived from it.
- `loadCombatantEntityLists()`'s sequential `character`/`npc`/`monster` fetches
  → `Promise.all`, matching the concurrency pattern already used elsewhere in
  the same file — fixed.
- **`list_groups` N+1** (`server/groups.py`) — was `1 + up to 4×N` queries for
  N groups (member/share-link fetches ran inside the per-group loop). Added
  `_fetch_group_members_batch` (one JOIN across every group id at once, same
  batched-title-lookup pattern the single-group version already used) and
  `shares.py#get_share_links_batch`; `_fetch_group_members` (still used by
  every single-group call site) now just calls the batch version with a
  one-element list, so both paths share one implementation.
- **`load_kind_policy` caching** (`server/kinds.py`) — read + parsed the same
  kind's JSON file from disk on every call, uncached, and some request paths
  called it more than once. Kind registry files are static at runtime (no
  route writes them), so `ServerState` now carries a `kind_policy_cache` dict,
  populated on first read and cleared on `state.reload()`.
- **Startup backfill N+1** (`server/storage.py#_backfill_flat_library_kinds`)
  — ran one `SELECT 1 ... WHERE kind=? AND id=?` per file on disk. Now one
  query fetches every existing `(kind, id)` pair into a set first, then each
  file is a plain membership check.
- Decided directly rather than deferred for profiling: all three are
  structural N+1s / zero-caching, not marginal — the fixes are simple and
  non-behavior-changing, so they didn't need load data to justify.

## Hardcoded values

### Fixed this pass

- `server/app.py`'s D&D-Beyond-proxy allowed-hosts set baked one specific
  third-party service into the otherwise system-agnostic core server — moved
  to `server.config.json`.
- **`common/js/lib/lookup-tables.js`** — a full module of D&D-5e vocabulary
  (skills, conditions, alignments, sizes, etc.) living in code instead of the
  System definition it duplicates. This was the plan's most significant scope
  change: originally proposed as a low-effort rename, but investigation showed
  it's fully fixable — see **`common/docs/lookup-tables-migration.md`** for the
  complete table-by-table mapping, the new `sys.dnd5e.json` fields/metadata this
  produced, and the 3 consumer files rewired to read the System record instead
  of a static import. The file itself, and the fully-dead `common/ddb-
  parser.js` that duplicated it a second time, are both deleted.

### Fixed in phase 2

- **`server/storage.py`'s `_extract_metadata`/`_title_from_payload`** hardcoded
  per-kind field knowledge directly in Python — only `character`/`template`/
  `system` had real branches, every other kind got the bare default with no
  way to opt in without editing this function. Redesigned to read two new
  *optional* fields off a kind's own registry entry
  (`common/data/kind/{id}.json`, the same file `load_kind_policy` already
  reads): `titleFields` (ordered dotted-path list, e.g. `["name",
  "data.name"]`; absent falls back to the suite-wide default `["title",
  "name"]`) and `metadataFields` (flat field names to copy into the metadata
  blob; absent means no metadata, exactly today's behavior for every kind
  that doesn't set it). Added both to `character.json`/`template.json`/
  `system.json`, preserving each of their 3 previously-hardcoded special cases
  exactly. A new kind that wants either now adds two lines to its own JSON —
  genuinely zero server code changes, closing the gap this item's own name
  described.
- Tier/role table duplication between `data-manager.js`/`account.js` — see the
  Redundancy section's phase 2 entry; this was the same finding viewed from
  the hardcoded-values angle (the same vocabulary spelled out twice, drifted).

### Considered and judged justified as-is

- `loom/mappings/ddb-character.json`/`ddb-monster.json` themselves, and the
  D&D-specific glue in `mapping-custom-functions.js`/`common/js/lib/system-
  lookup-tables.js` — these files exist specifically to import D&D Beyond
  content, which only ever means D&D 5e. Being D&D-aware is their entire job,
  not a violation of "system config belongs in data" — the violation was the
  *vocabulary values* living in code instead of the System record, which is
  what the migration above actually fixed.

## Conventions worth codifying

Moved to `common/docs/code-conventions.md` — this document stays scoped to
findings, that one to the reusable patterns those findings confirmed.
