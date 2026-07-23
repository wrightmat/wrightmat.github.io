# CLAUDE.md — Undercroft Crucible

## Project Overview

Undercroft Crucible is the monster concept generator of the Undercroft suite. It
produces a structured monster identity — enough information for a DM to understand
the creature and enough mechanical scaffolding to build a balanced encounter — without
requiring an LLM. Full narrative generation (lore, appearance, ecology, flavor text)
is optional and out of scope: a human or an LLM can take Crucible's structured output
and write that prose later, exactly the same relationship Forge has to its generated
NPCs.

Crucible is systematically similar to Forge (a tool that reads Library-kind reference
data and produces a saved output record), but its generation algorithm is entirely
different: Forge rolls dice against static, location-weighted tables; Crucible has no
dice at all. It selects a coherent set of features by filtering tag compatibility and
traversing a recipe defined by the chosen Archetype.

---

## Undercroft Suite Context

Every data type Crucible needs is a Library kind, managed the same way as every other
kind in the suite (Loom's generic Library tab, `dataManager.list/get/save/delete`,
DB-backed ownership/sharing/`is_public` via `library_items`, per-kind tier policy from
the kind registry). Crucible itself has **no dedicated authoring UI** for its
reference data — Creature Types, Archetypes, Roles, and Features are all authored in
Loom, the same way Locations and Species Name Profiles are authored in Loom's Places
panel rather than in Forge. Crucible only reads them, plus writes its own generated
output (the `monster` kind).

Crucible has **no whole-tool tier gate** — it stays open like Forge, not gated like
Loom, since it mainly reads reference data rather than authoring the sensitive parts.
Saving a generated monster follows Forge's NPC pattern exactly: an anonymous GM saves
locally to their own browser, a signed-in user gets a real owned/shareable record.

---

## Conceptual Architecture

A monster concept is built from three independent axes plus a pool of atomic building
blocks:

- **Creature Type** — the thematic expression and available vocabulary (what the
  monster *is*): naming conventions, default senses/resistances/immunities, and the
  trait tags its features are likely to draw from.
- **Archetype** — the monster's behavioral strategy and the recipe of problems it
  creates (how it tries to win): a signature slot (its one defining trick), required
  slots (what it needs to actually execute that strategy), optional slots (what
  rounds it out), and behavior tags it actively avoids.
- **Role** — the monster's encounter function and mechanical tendencies (how it
  participates in combat): HP/AC bands, damage profile, and action-economy shape.

**Features** are the atomic building blocks (combining what D&D would traditionally
call traits and abilities into one concept). Each feature is tagged with:
- `behaviors` — descriptive categories (mobility, control, damage, defense, fear, ...).
- `recipeSlots` — which Archetype recipe slots this feature can fill.
- `roles` / `creatureTypes` — which Roles/Creature Types this feature fits (an empty
  list means universally compatible — the existing suite-wide convention of "no tag
  means unconstrained").
- `synergizesWith` / `conflictsWith` — plain arrays of other feature ids. These are
  ordinary fields on a feature's own JSON body, not a separate relationship data
  type — the same way a System's `entityKind`/`values` are just fields on a System.

### Generation flow

Creature Type, Archetype, and Role are all optional **override** selects — exactly
like Forge's Species/Archetype/Alignment/Gender overrides: blank means "resolve this
randomly," set means "pin this value." Nothing is required to pick before generating.

1. Resolve the three axes: any axis left blank gets a random eligible value (filtered
   to the active System) before generation proceeds, so the algorithm always ends up
   with concrete Creature Type/Archetype/Role values whether the user picked them or not.
2. The resolved Archetype's `recipe` establishes the signature slot, required slots,
   and optional slots to fill.
3. Resolve the **signature feature**: the user's explicit pick if given, otherwise a
   random feature tagged for the recipe's signature slot and compatible with the
   resolved Role/Creature Type. The user can also lock in additional starting
   features beyond the signature before traversal runs.
4. **Traversal**: for each remaining required slot, then each optional slot, pick the
   best-synergy, non-conflicting, compatible candidate feature (falling back to any
   compatible non-conflicting candidate if none share synergy with what's already
   selected). An optional slot that can't be filled is recorded as unfulfilled, not a
   hard error — an incomplete recipe is still a usable, honestly-labeled result.
5. The output is a structured record: Creature Type, Archetype, Role, the selected
   feature ids, and a recipe-fulfillment summary showing which slot was filled by
   which feature (or left unfulfilled).

See `js/lib/generator.js` for the concrete implementation.

---

## Starter Content

A real D&D 5e starter set ships with Crucible (not placeholder data):

- **Creature Types**: all 14 standard 5e types — Aberration, Beast, Celestial,
  Construct, Dragon, Elemental, Fey, Fiend, Giant, Humanoid, Monstrosity, Ooze, Plant,
  Undead.
- **Roles**: the full 9-role list (MCDM-style, the 5e analogue of 4e's role system) —
  Ambusher, Artillery, Brute, Controller, Leader, Skirmisher, Soldier, Solo, Support.
- **Archetypes**: 12 example archetypes, each a 4-step recipe (signature slot +
  3 required slots, derived directly from the archetype's own verbs) — Predator
  (Engage/Isolate/Exploit/Pursue), Guardian (Defend/Deny/Punish/Endure), Hunter
  (Pursue/Harass/Mark/Finish), Ambusher (Hide/Initiate/Burst/Escape), Bully
  (Threaten/Disable/Punish/Dominate), Duelist (Challenge/Counter/Outmaneuver/Finish),
  Parasite (Drain/Spread/Sustain/Escape), Commander (Command/Enhance/Position/Adapt),
  Destroyer (Damage/Disrupt/Escalate/Persist), Trickster
  (Mislead/Trick/Reposition/Escape), Swarm (Multiply/Surround/Sacrifice/Recover),
  Survivor (Resist/Recover/Adapt/Endure). Note the Ambusher Archetype and the Ambusher
  Role share a name but are different axes — a Role describes combat function, an
  Archetype describes strategy; a monster can be either, both, or neither.
- **Features**: 59 features — 40 universal (role/creature-type-unconstrained) features,
  one per distinct recipe slot across all 12 archetypes, plus 19 narrower flavor
  variants tagged to specific Roles/Creature Types. Verified: every Archetype +
  Role + Creature Type combination (1,512 total) resolves its signature and required
  slots with no gaps, and no two mutually-conflicting features are ever selected
  together (checked via 30,240+ generation trials against the real recipe/traversal
  logic).

---

## Out of Scope

Narrative generation (lore, appearance, ecology, flavor text) is deliberately not
part of Crucible. The structured output is the deliverable; turning it into prose is
left to a human GM or a separate LLM step, mirroring how Forge's optional note
generation is a thin, separate layer on top of its own structured NPC output rather
than something the core generator does itself.
