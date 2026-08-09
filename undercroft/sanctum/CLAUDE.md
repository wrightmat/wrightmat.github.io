# CLAUDE.md — Undercroft Sanctum

## Project Overview

Undercroft Sanctum is the procedural location generator of the Undercroft suite. It
creates useful, interconnected places for tabletop campaigns at any scale — regions,
settlements, structures, complexes, individual rooms — with enough identity, context,
resources, and problems to provide value at the table, and enough structure to
underpin future systems such as quest generation. It is not intended to simulate a
complete world: every Location gets exactly what it needs to be useful, not a
simulated economy or population model.

Sanctum is systematically similar to Crucible/Vault (reads Library-kind reference
data, produces a saved output record via a tag-compatible, synergy-weighted pick), but
its role in the suite is different in one important way: **Sanctum is also the sole
authoring surface for Setting and Location** — Loom's old "Places" panel (a narrow
Forge-specific NPC-generation config editor) has been retired and fully absorbed here,
because Sanctum's Location model subsumes what a "place" means suite-wide.

---

## Undercroft Suite Context

Every reference kind Sanctum reads is authored in Loom's generic Library JSON editor
(no dedicated Sanctum UI for these, same as Crucible's/Vault's reference kinds):
`location-type` (5 starter values: Settlement, Structure, Complex, Region,
Environment), `location-purpose` (12 starter values: Habitation, Protection,
Commerce, Governance, Resource, Industry, Transportation, Knowledge, Worship,
Recreation, Confinement, Exploration), `resource` (reusable abstract concepts like
"Iron Ore" that Assets/Needs can reference), and `feature` (the same shared kind
Crucible/Vault use, retrofitted with a `"location"` category alongside
`"monster"`/`"spell"`/`"item"`).

Environment itself is **not** a Library kind — it's a value from the active System's
`"environment"`-keyed generator-property field (an ordinary array field in the
System's `fields`, the same mechanism Vault reads for Rarity/Activation/Item Form —
there is no separate "propertyTypes" concept), looked up by the conventional key
`"environment"` and translated to a simple `{id, label, values}` shape by
`loadEnvironmentPropertyType` in `js/app.js`. Sanctum has no hardcoded notion of what
environments exist; a different System can define an entirely different set with zero
Sanctum code changes.

`setting` and `location` are the two kinds Sanctum authors directly (not through
Loom's generic editor — Sanctum has its own dedicated CRUD for these, described
below). A Location's 4 legacy Forge-generation fields (`speciesWeights`,
`mixingCoefficient`, `archetypeOverrides`, `genericNameFallback`) are **optional** —
not every place needs a population Forge can roll NPCs from (a Room doesn't; a
Settlement or Region might) — hidden behind a collapsed "NPC Generation Config"
section rather than always shown. Forge's own read side needs no awareness of
Sanctum at all: it already reads these fields defensively (`entity?.speciesWeights ||
[]`), so a Location with none of them set still generates NPCs gracefully (falling
back to "Other"/generic names).

Sanctum has **no whole-tool tier gate** — it stays open like Forge/Crucible/Vault.
Saving follows the same `dataManager.save("location"/"setting", id, record)`
local-first/auto pattern as everything else in the suite. Save is gated on an actual
change (a "clean" baseline established at load/save, compared against the live form —
same `isDirty`/`markClean` convention Loom uses for Systems) for both `location` and
`setting`; Delete is gated owner-or-admin (`locationAllowsDelete`/`settingAllowsDelete`
in `js/app.js`, mirroring Loom's `systemAllowsDelete`/`libraryEntryAllowsDelete`
exactly, including the "local-only content is always deletable" case).

Both `location` and `setting` associate to a System via `systemIds` — a plural array,
exactly like every other Library kind (`feature`, `species`, `npc`, ...), not a
separate singular `systemId` scalar. In practice a Location/Setting only ever belongs
to one System, so the array always holds exactly one entry, but using the same
`systemIds` convention as everything else means Loom's generic Library editor's
"Assigned Systems" checkboxes work correctly out of the box, and every filter helper
in the suite (`matchesSystem`-style: empty array or `includes(systemId)`) behaves
identically regardless of kind. There is no separate `systemId` field anywhere —
an earlier pass introduced one before this was corrected; don't reintroduce it.

A Location also carries a plural `settingIds` array — which Setting(s) it belongs to
— using the exact same "empty/absent = universal, non-empty = restricted" convention
as `systemIds`, for the same reason: Loom's generic "Assigned Settings" checkboxes
(a sibling to "Assigned Systems") write into this field with zero kind-specific code,
and any consumer filters it the same `matchesSetting`-style way regardless of kind. In
practice a Location only ever belongs to whichever one Setting is currently selected
in Sanctum's own editor, so the array holds exactly one entry today — plural just
future-proofs a place reachable from more than one Setting. `resource` entries can
also carry `settingIds` (e.g. an Eberron Dragonmarked-house service scoped only to
the Eberron Setting) — unlike Location, an empty/absent array on a Resource means
universally available, checked via `matchesSetting()` in `js/lib/generator.js`
alongside the existing `matchesSystem()`/`matchesLocationTags()` filters. There is no
separate singular `settingId` field going forward — a handful of pre-migration
records may still carry the old scalar on disk, so any code reading this field falls
back to treating a lone `settingId` as `[settingId]` (same precedent as the
`system` → `systemIds` character migration), but never writes it back out.

---

## Conceptual Architecture

Every Location is defined by: Name, Type, Purpose, Environment, Features, Assets,
Needs, and Relationships. Unlike Crucible (recipe slots) or Vault (a budget economy),
**Sanctum has neither** — Feature and Resource selection is a plain tag-compatible,
synergy-weighted pick:

1. Resolve Type/Purpose (optional overrides, else random) and Environment (read from
   the active System's `"environment"`-keyed generator-property field, if it defines
   one).
2. Filter `feature` entries to `categories.includes("location")` and
   `resource` entries — both against the resolved Type/Purpose/Environment via three
   tag arrays (`tags.locationTypes`, `tags.locationPurposes`, `tags.environments`; an
   empty array means universally compatible, the same convention as Crucible's
   `tags.roles`/`tags.creatureTypes`).
3. **Feature traversal**: one random compatible feature seeds the result (or the
   caller's locked features), then the best-synergy, non-conflicting compatible
   candidate is repeatedly added until a randomized target count (2-4) is reached or
   nothing else qualifies — a zero-synergy feature is never pulled in automatically,
   the same restraint Vault applies.
4. **Resource pick**: 1-3 compatible resources for Assets, then 1-3 more (excluding
   whatever Assets already took) for Needs.
5. Relationships (`parentId`, `connectedTo`) always start empty on a freshly generated
   Location — the GM sets them deliberately afterward; a random parent or connection
   would be meaningless without the GM's own world context.

See `js/lib/generator.js` for the concrete implementation.

### Relationships

- **`parentId`** — containment (a settlement's parent is its region). A single scalar,
  resolved client-side by filtering the current Setting's location list; no DB relation
  table or server route, consistent with every other cross-record reference in this
  codebase. "Children" are never stored, always computed (locations in this Setting
  whose `parentId` equals mine).
- **`connectedTo`** — peer links (a road, a tunnel), a plain id array checked
  bidirectionally by any consumer (A connects to B if either lists the other) — the
  same convention Vault's `synergizesWith` uses, so an author only writes the link
  once.

### Assets and Needs

Both use the same generic reference shape: `{ kind, refId, label, description }`.
`kind` is usually `"resource"` (the automatic generator only ever populates these),
but can be any other Library kind (`npc`, `monster`, `effect`) for linking a specific
real entity — a manual authoring action in Sanctum's UI (pick a kind, then an entity
of that kind), never invented by the generator itself. Assets, Needs, and Features
deliberately share one row-rendering shape (`createListRow` in `js/app.js`) and one
single-line "kind/entity + Add" input row, so all three feel like the same list-editing
primitive rather than three bespoke UIs.

A narrow, specific function (e.g. "this place is a shop, its Assets are its wares")
is modeled as a **Feature**, not a new Location Type or Purpose — Type/Purpose stay at
their existing broad granularity (physical scale / general function), while Features
already exist precisely to layer on additional, freely-combinable characteristics
(`feat.shop` is the concrete example: any Location can carry it alongside whatever
Type/Purpose/other Features it already has, rather than inventing a parallel taxonomy
entry or a combinatorial Type just to express one specific concept).

---

## Setting/Location Authoring (absorbed from Loom's retired Places panel)

Sanctum's left pane provides the System > Setting > Location cascading pickers
(context for what you're working on); the right pane's collapsible **Setting
Properties** section (name, description, New/Save/Delete toolbar) is where a Setting
is actually authored — mirroring the "Template Properties" pattern already
established elsewhere in the suite (a picker in one place, a collapsible
properties/toolbar panel for whatever's selected in another). There is no separate
"New Location" action — the Location picker's own blank "New / unsaved" entry already
covers starting fresh, and Generate Location is what actually produces a record.
Relationships (Parent, Connected To, Children) live in the center pane alongside
Features/Assets/Needs, since they're part of the Location's own definition, not
initial-selection context.

Unlike Crucible/Vault's one-shot "generate and save" pattern, revisiting and expanding
a Location over many sessions is core to Sanctum's purpose, so loading an existing
Location (including Forge's original hand-authored ones like `sharn`/`sword-coast`)
back into the editor is a first-class flow, not an afterthought.

The optional "NPC Generation Config" section (species weight rows with a running
total, a 0-1 mixing-coefficient slider, setting-specific archetype-override rows,
generic-name-fallback rows) is ported directly from Loom's old Places panel — same
row-editor behavior, just relocated and made optional rather than always-present.

Every collapsible section in Sanctum (Setting Properties, NPC Generation Config, JSON
Preview) uses the one shared `bindCollapsibleToggle` helper
(`common/js/lib/collapsible.js`) — the same toggle mechanism Loom's Systems section
and Press's Template Properties already use — rather than each rolling its own
collapse behavior.

---

## Starter Content

A real starter set ships with Sanctum (not placeholder data): 5 Location Types, 12
Location Purposes, 11 Environment values (the classic 5e DMG environment list) on
`sys.dnd5e`, 10 Resources, and 13 location Features (damage-free, place-flavored:
Fortified Walls, Under Siege, Black Market, Smuggler's Tunnels, Bustling Market, Ley
Line Confluence, Sacred Ground, Haunted, Polluted Waters, Ancient Ruins Beneath,
Corrupted, Isolated, Shop) with real `synergizesWith`/`conflictsWith` relationships
(including one hard-conflict pair, fire-vs-corruption-style: Sacred Ground vs.
Corrupted) to exercise the same traversal logic Crucible/Vault already use.

---

## Out of Scope

Sanctum deliberately does not simulate a complete world, an economy, or a population
model — Assets/Needs describe what a place has or lacks in broad strokes, not a ledger.
Narrative generation (lore, history, physical description) is left to a human GM or
the optional Generate Note LLM step (`js/lib/llm-note.js`, `POST
/sanctum/generate-note`), mirroring Crucible's/Vault's own optional note generation
exactly.
