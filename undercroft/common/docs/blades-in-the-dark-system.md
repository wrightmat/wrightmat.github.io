# Blades in the Dark — System-Agnosticism Stress Test

Added as the second real System (`sys.bitd`, alongside `sys.dnd5e`) specifically to exercise the suite's generic infrastructure against a game with no ability scores, no HP/AC, no spellcasting, dice-pool resolution instead of d20+modifier, and no import source (unlike D&D, which is always populated via the DDB mapping pipeline — every Blades character in this suite is built by hand in Play/Edit, which is itself a mostly-unexercised path).

## What shipped

- `common/data/system/sys.bitd.json` — 23 fields. No generator-property fields (Rarity/Activation/Item Form/Environment) and no `combatBindings`/`creatureTypes`/`combatScaling` — Blades has no analogue for any of them, and none are required.
- `common/data/template/tpl.bitd.character.json` — the scoundrel sheet: Identity, Attributes (computed) & Actions, Stress/Trauma/Armor/Healing, Harm, Load & Loadout, Special Abilities (one Container per Playbook, Visible-gated), XP clocks, Coin/Stash, Contacts.
- `common/data/template/tpl.bitd.crew.json` — a second Template on the *same* System: Crew Identity, Heat/Wanted, Coin/Vault, Upgrades, Claims, Cohorts. Crew needed no schema-level "record kind" concept — a Template already isn't 1:1 with a System, so a second sheet type is just a second Template.
- `common/data/character/rook.json` and `the-red-lanterns.json` — one hand-authored Character and one Crew record exercising every field above.

**Restart the server before trying these in the app** — new Library-kind files are only discovered by `_backfill_flat_library_kinds()` (`server/storage.py`) on server start, not live.

## Patterns used (all pre-existing capability, nothing new built)

- **Computed Attributes** — Insight/Prowess/Resolve are Text components with `=sum(@actions.insight.hunt,@actions.insight.study,...)`, not stored values. Exercises this session's formula work directly.
- **Action ratings** — Track (linear, 4 segments) per action, not Toggle. A dot-rating is a fill-count, which is exactly what Track already models; Toggle is for a single named state, not a count.
- **Clocks** — Track (circular) for Healing/Wanted, matching Blades' own visual language; Track (linear) for Stress/Heat/XP. Same component, no new work — the shape choice is purely the trackShape field.
- **Playbook-specific abilities without dynamic Source filtering** — a Tabs Container per Playbook, each tab holding that playbook's own abilities as literal template content (mirroring how a real Blades playbook is its own physical sheet page). No "filter a choice list by another field's value" capability was needed or built; a suspected gap from the planning pass turned out not to be one.
- **Boolean-shaped checkboxes** (Carried/Purchased/Controlled/took-this-ability) — Input(checkbox) with a single static `options: ["Label"]` entry. Input's checkbox variant has no bare single-boolean mode; it's a checkbox *group* down to one item, giving `["Label"]`/`[]` instead of `true`/`false`. Fine functionally, worth knowing before assuming a plain boolean field will render anything on its own.

## Confirmed during implementation (not just planned)

- `newSystemEditor()` (Loom) seeds zero fields on a new System — `feedback_system_property_seeding`'s principle already holds in the current code. Vault's own CLAUDE.md still claims all-new-Systems get the 4 default generator-property fields; that's stale documentation, not current behavior.
- Vault's `getSystemPropertyTypes` filters a System's fields to ones that look like generator properties and returns `[]` for a System with none — no crash, no special-casing needed for a System with zero magic-item economy.
- Crucible's Creature Type/Combat Scaling field lookups default to conventional field names (`creatureTypes`/`combatScaling`) and are absent-safe the same way.
- Sanctum's Environment lookup is already documented as optional per-System.

## Deliberately left alone

- **Forge** — its Archetype table is D&D Monster Manual stat blocks, configured per-`location`, not per-System. A Blades-flavored `location` (Doskvol street NPCs) is a real, separate authoring task if wanted later — out of scope here.
- **Crucible** — monster generation doesn't map to Blades' fiction (no monsters as such). Left unused for this System rather than forcing content in.
- **Combat Tracker widget** — its Role vocabulary (`resource`/`value`/`tags`/`modifier`) is generic, but neither Character template declares a Role-tagged field, so the widget has nothing to bind for a Blades character yet. Wiring Stress as a `resource`-role field is a small, optional follow-up if live Dashboard tracking for Blades sessions is wanted — the widget's own internal `hp`/`ac` variable names are cosmetic only (no hardcoded "HP"/"AC" display text found), so this is a data-authoring task, not a code change.

## Actual gaps found (none blocking)

None turned out to require a code change. The one candidate gap identified during planning — conditional/filtered Source lists — was resolved with an existing capability (Visible formula + one Container per option) rather than new engineering. If a future System needs *many* more conditional branches than Blades' 7 playbooks, that formula-per-Container approach won't scale as nicely and a real filtered-Source mechanism would be worth revisiting then — not needed now.

## Real bug found through actual use: Binding/Source key collision

Caught live, not by review: the Heritage field's `binding` (`@heritage`, the character's own chosen value) and `sourceBinding` (originally also `@heritage`, the System's lookup list) used the *same* key. `resolveSourceBindingValue` (workbench-character-view.js) resolves a Source path against several contexts in priority order, and `state.draft` (the live character) is checked *before* `state.systemPreviewData`/`state.systemDefinition` — with `allowDirect: true` on both. The moment the character got a real `heritage` value (a plain string), the Source lookup started resolving to that string instead of the System's lookup array, since the draft context wins first — collapsing the dropdown to empty, and persisting that way since the character's own `heritage` field is what's now "winning" the lookup on every load.

Every other field in both templates deliberately used a plural System-field name distinct from the singular character-field name (`backgrounds`/`background`, `playbooks`/`playbook`, `vices`/`vice`, `armorTypes`/`armor`, `loadTiers`/`load`, `traumaConditions`/`trauma`, `crewPlaybooks`/`crewPlaybook`, `crewReputationTags`/`reputation`) specifically to avoid this — Heritage was the one field that missed it. Fixed by renaming the System field `heritage` → `heritages` (`sys.bitd.json`) and updating the Heritage Input's `sourceBinding` to match (`tpl.bitd.character.json`) — no character data needed fixing, since a character's own already-saved `heritage` value was never the corrupted part, just what it was colliding with.

**Rule of thumb for any future System**: a component's `binding` (writes to/reads from the character) and `sourceBinding` (reads a choice list from the System) must never share the same key name. This isn't validated or warned about anywhere in the editor — it fails silently and only shows up once a real value is set, which is exactly what made it easy to miss during initial authoring and confusing to diagnose after the fact.
