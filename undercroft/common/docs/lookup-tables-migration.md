# `lookup-tables.js` migration

`common/js/lib/lookup-tables.js` was a module of hardcoded D&D 5e vocabulary
(conditions, alignments, abilities, skills, sizes, ...) that the DDB-import
pipeline used to decode D&D Beyond's numeric IDs into Undercroft's own values.
It's been deleted; every value it held now lives on `common/data/system/
sys.dnd5e.json` — editable in Loom like any other System field — and is
derived at runtime by `common/js/lib/system-lookup-tables.js`'s
`deriveLookupTables(systemPayload)`.

## Why this wasn't just a relocation

The mapping engine (`mapping-engine.js`'s `makeLookupFn`/`applyMapping`) was
already fully generic — `lookupTables` is an injected parameter, not a fixed
import. The actual violation was that the *vocabulary values* (the list of
conditions, alignments, skills, ...) were hardcoded in JS instead of coming
from the System record a GM/creator edits in Loom. Moving the file to a
different path would have preserved that violation; deriving the same shapes
from `sys.dnd5e.json` at runtime fixes it.

`common/ddb-parser.js` — the "hand-written parser" `lookup-tables.js`'s own
header comment referred to — turned out to be fully dead code (zero imports
anywhere), independently hardcoding its own second copy of all 12 tables. It
was deleted outright rather than migrated.

## Table-by-table disposition

| Old table | Status | Where it lives now |
|---|---|---|
| `ALIGNMENTS` | Already covered | `sys.dnd5e.json`'s `alignments` field already had `sourceId` on every entry — zero data changes needed. |
| `CONDITIONS` | Extended | `conditions` field's 15 entries each got a `sourceId` (1-15, matching the old array position). Position 4's `"Exhausted"` became the System's existing `"Exhaustion"` — same DDB position, canonical name. |
| `ACTIVATIONS` | Extended | `activation` field's 3 matching entries (Action/Bonus Action/Reaction) got `sourceId`s; 4 new entries (Seconds/Minutes/Hours/Special, `cost: null`) cover DDB's remaining casting-time-unit codes. Each entry also got a `shortName` (the original short code: "A"/"BA"/"R"/"s"/"m"/"h"/"S") since that — not the full word — is what `castingTime` actually gets set to. |
| `COMPONENTS` | New field | `components` (Verbal/Somatic/Material), each with `sourceId` + `shortName` (V/S/M). |
| `DAMAGES` | Dropped | Only ever referenced by the now-dead `ddb-parser.js` — no mapping JSON or custom-function call site used it. Not migrated anywhere. |
| `DURATIONS` | Dropped | Same as `DAMAGES` — dead-only reference. |
| `ABILITIES` | Extended (no new field) | `abilities`'s 6 existing number-field *children* (the character-sheet score shape — untouched) each got `shortName` + `sourceId` metadata. A separate vocabulary field would have just duplicated what `abilities.children` already enumerates. |
| `SAVING_THROW_SUBTYPES` | Extended (no new field) | `saves`'s 6 children each got a `ddbSubtype` string (e.g. `"strength-saving-throws"`). |
| `SENSES` | New field | `senses` (Blindsight/Darkvision/Tremorsense/Truesight). The old table's 5th "unknown" entry was a DDB-parser defensive fallback, not real vocabulary — not stored, synthesized by consumers instead. |
| `SIZES` | New field | `sizes` (Tiny...Gargantuan), each with `sourceId` + `shortName` (tiny/sm/med/lg/huge/grg — `deriveLookupTables` translates this back to the legacy `value` key, since that's what `mapping-custom-functions.js`'s `determineSize` matches against DDB's raw size strings). |
| `SKILLS` | New field | `skills` (18 entries), each with `ability` naming the linked ability directly (`"strength"`) instead of the old fragile positional `stat` index into `ABILITIES`. |
| `SPEEDS` | New field | `speeds` (Walk/Burrow/Climb/Fly/Swim), each with `sourceId` + `shortName` (walking/burrowing/...) — kept for consistency, though no consumer currently reads it (the legacy table's `innate` property was likewise never read). |

All four of `activation`/`components`/`sizes`/`speeds` originally used a
field-specific name for this same "short/abbreviated form" concept
(`abbreviation`, `value`, `innateLabel`) before being standardized on
`shortName` — the same property name `alignments`/`abilities` already used —
so Loom's generic per-value "Short name" column already covers all of them
with no per-field special-casing needed in the System editor itself.

## How the pieces fit together

- **`deriveLookupTables(systemPayload)`** reshapes `sys.dnd5e.json`'s fields
  back into the exact object/array shapes the old static constants had
  (`{id, name, friendlyName, shortName}` object-arrays for
  abilities/alignments/sizes/skills/senses/speeds; plain positional string
  arrays for activations/components/conditions, matching how
  `lookup('conditions', @value)` etc. expect a bare string back, not an
  object). `mapping-engine.js`'s `makeLookupFn` needed **zero changes** — every
  derived object already carries an `id` (copied from the System's own
  `sourceId` convention), so its existing `entry.id === key` match keeps
  working unmodified.
- **`mapping-custom-functions.js`** changed from a static `export const
  customFunctions = {...}` to a factory, `createMappingCustomFunctions(lookupTables)`,
  closing over the derived tables instead of importing 4 static constants.
  Every function body is otherwise unchanged.
- **`content-fetch.js`**'s `loadDdbData(value, dataManager)` fetches
  `sys.dnd5e` once per session (`{ preferLocal: false }`, cached the same way
  `loadCharacterMappingDefinition` caches the mapping JSON fetch), derives the
  lookup tables, and builds `customFunctions` from them before calling
  `applyMapping`.
- **`loom/js/app.js`** does the same fetch-once-and-cache at startup (after
  its tier gate passes), storing the result in a module-level
  `ddbLookupContext` that `runLivePreview()` reads synchronously on every
  mapping edit.

## If you're doing a second cleanup pass

- Confirm the 4 best-guess `activation` entries' labels (Special/Minutes/
  Hours/Sight) in Loom against real DDB spell data, and rename if wrong — only
  the `abbreviation` values (s/m/h/S) are confidently sourced from the old
  table.
- If a future System (not `sys.dnd5e`) ever needs DDB import support, it would
  need the same `sourceId`-enriched fields — `deriveLookupTables` degrades
  gracefully (empty arrays/objects) for a System missing any of them, so
  there's no hard failure, just silently-blank lookups.
