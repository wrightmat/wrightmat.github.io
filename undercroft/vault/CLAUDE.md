# CLAUDE.md — Undercroft Vault

## Project Overview

Undercroft Vault is the spell/magic item concept generator of the Undercroft suite.
Where Crucible starts from behavior (an Archetype's recipe) and derives mechanics,
Vault inverts that: it starts from mechanics — a **Signature Effect** — and builds
outward through a shared graph of `feature` entries, using a point-based **effect
economy** (not recipe slots) as both the compatibility engine and the stopping
condition. The result is a structured mechanical concept — enough for a GM to
understand what it does and enough scaffolding to present it as a balanced spell or
magic item — without requiring an LLM. Full narrative generation (flavor text, lore)
is deliberately optional and out of scope, exactly like Crucible's relationship to its
generated monsters and Forge's relationship to its generated NPCs.

---

## Undercroft Suite Context

Every data type Vault needs is a Library kind or an authored System field, managed the
same way as every other kind in the suite:

- **`feature`** — the same Library kind Crucible already established (Loom's generic
  Library tab, `dataManager.list/get/save/delete`, DB-backed ownership/sharing via
  `library_items`). Retrofitted (not duplicated) with a `tags.categories` field so one
  shared mechanics library serves both generators — Crucible's own 59 monster features
  are tagged `["monster"]`; Vault's own features are tagged with `"spell"`/`"item"`.
  Also carries `budgetCost` (positive spends the budget, negative refunds it — a
  drawback) and `dependsOn` (hard prerequisite feature ids, alongside the existing
  `synergizesWith`/`conflictsWith`).
- **Generator properties** (Rarity, Activation, Item Form for `sys.dnd5e`) are NOT a
  separate concept or Library kind — they're ordinary array-type fields in a System
  record's `fields` (Loom's single "Properties" editor, the same place `classes`/
  `species`/etc. live), distinguished only by carrying a numeric `cost` or
  `targetBudget` on every value. Exactly one field is the ceiling-setter, named by
  Vault's own `budgetCeilingField` **tool preference** — a per-System choice stored in
  this browser's local storage (`js/app.js`'s `getBudgetCeilingFieldPreference`/
  `setBudgetCeilingFieldPreference`, bucket `"vault-settings"`), picked from a dropdown
  in Vault itself, not System data edited in Loom: which field acts as the ceiling is
  Vault's own interpretive choice among a System's fields, not an objective fact about
  the System's data model, so it never round-trips through the System record. That
  field's chosen value's `targetBudget` becomes the generation's target budget while
  every other generator-property field's chosen value contributes its `cost` into the
  amount spent.
  Vault has **no hardcoded knowledge** of "Rarity"/"Activation"/"Form" as concepts — its
  `js/lib/tables.js#getSystemPropertyTypes` reads `system.fields` (plus the
  `budgetCeilingField` preference, passed in as a parameter), filters to fields that
  qualify as generator properties, and translates them to the legacy `{id, label,
  setsBudgetCeiling, values: [{id, label, cost, targetBudget}]}` shape the rest of
  Vault's code (unchanged) already expects — `setsBudgetCeiling` here is derived per
  field (`field.key === budgetCeilingField`), not read from the field itself; `id` is a
  slugified form of each value's `name`.
  A different System (a different game) can define a completely
  different set of property types/values with zero Vault code changes, the same way
  adding a new Library kind requires zero server code changes. Every newly-created
  System is seeded with the 4 default generator-property fields (Rarity, Activation,
  Item Form, Environment) by Loom's `newSystemEditor()`, but they live in the same
  editing UI as every other field — there is no separate "Generator Properties"
  section anymore.
- **`effect`** — Vault's own generated-output Library kind (mirrors `monster` exactly:
  `readTier: free`, `writeTier: free`).

Vault has **no whole-tool tier gate** — it stays open like Forge/Crucible, not gated
like Loom, since it mainly reads reference data. Saving a generated effect follows
Crucible's monster pattern exactly: an anonymous GM saves locally to their own browser,
a signed-in user gets a real owned/shareable record.

---

## Conceptual Architecture

A Vault effect has no independent identity axes (no Creature Type/Archetype/Role
analogue) — it's built from exactly two ingredients:

- **Properties** — one resolved value per System-defined property type (e.g. Rarity,
  Activation, Item Form for `sys.dnd5e`). Each is an optional override (blank = random,
  same convention as Crucible's Creature Type/Archetype/Role): pinning one narrows
  generation, leaving it blank lets the generator resolve it. Exactly one property type
  sets the target budget ceiling; every other chosen value spends from (or, if
  negative, refunds into) that budget.
- **Features** — the same atomic building blocks Crucible uses, filtered here to
  `tags.categories` including `"spell"` or `"item"`. One is the **Signature Effect**
  (an optional override, otherwise random); the rest are pulled in by traversal.

### Generation flow

1. Resolve every property type's value (explicit override or random), computing the
   target budget (from whichever property type is flagged `setsBudgetCeiling`) and the
   amount already spent by every other property's chosen value.
2. Resolve the Signature Effect: the user's explicit pick if given, else a random
   eligible feature. Add its `budgetCost` to the amount spent, along with any locked
   features the caller pinned before generation.
3. **Traversal** (no recipe slots — this is the core difference from Crucible):
   repeatedly find whichever remaining eligible feature has the strongest synergy with
   what's already selected, doesn't conflict with anything selected, and — bundled
   atomically with any of its own unmet `dependsOn` prerequisites — fits inside the
   remaining budget. Add it (and its dependency bundle) and repeat until nothing more
   qualifies. A feature with zero synergy to the current selection is never pulled in
   automatically, unlike Crucible's fallback-to-any-compatible-candidate (Vault has no
   required slots forcing a fill, so it only ever reinforces the existing concept).
4. The output is a structured record: resolved properties, the Signature Effect id,
   every selected feature id, and a `budget: { target, spent, remaining }` snapshot.

See `js/lib/generator.js` for the concrete implementation, including the shared
`computeBudget()` helper (used identically by the automatic generator and the manual
authoring UI below, so the two can never disagree about the running total).

### Basic authoring mode

The same result view stays live-editable after generation: Add/Remove controls on the
Features list let a GM hand-build or tweak a result within (or deliberately outside) the
intended budget, with the Target/Spent/Remaining readout recomputing on every change via
the same `computeBudget()` helper the generator uses. Going over budget is allowed
(creative freedom) but shown as a clear warning (the Remaining figure turns red) rather
than silently hidden or hard-blocked. This is not a separate mode/page — it's the same
view the automatic generator populates.

---

## Starter Content

A small, real starter feature set ships with Vault (not placeholder data): 14 features
covering damage (fire/cold, mutually exclusive via `conflictsWith`), control, healing,
detection/utility, summoning, three synergy-enhancing modifiers (extended range,
resistance-piercing, area burst), one hard-dependency example (Called Shot requires
Arcane Sight via `dependsOn`), and four drawbacks with negative `budgetCost` (limited
uses, short range, exposed casting, costly material) — enough to exercise synergy,
conflict, dependency-bundling, and budget-refund traversal end to end. `sys.dnd5e`'s
generator-property fields ship with Rarity (5 tiers, sets the budget ceiling),
Activation (4 options), and Item Form (Spell/Wand/Potion/Weapon).

---

## Out of Scope

Narrative generation (flavor text, lore, appearance) is deliberately not part of
Vault's core generator. The structured output is the deliverable; turning it into prose
is left to a human GM or the optional Generate Note LLM step (`js/lib/llm-note.js`,
`POST /vault/generate-note`), mirroring Crucible's own optional note generation exactly.
Properties are intentionally not (yet) their own authored Library kind — promoting them
from a System field to a full kind (mirroring how Systems/Templates matured) is a
natural future step, not this pass's job.
