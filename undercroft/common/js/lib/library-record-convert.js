import { evaluateDerivedFormula } from "./derived-formulas.js";

// Converts a Library record's payload from one kind to another WITHIN the
// same System — Forge NPC -> Workbench Character, Crucible Monster ->
// Workbench Character, and (a natural follow-up, not wired to any UI yet)
// any other kind pair. Deliberately NOT a per-pair mapping table: the
// combat-relevant subset (ability scores, HP, AC, initiative, alignment,
// senses, defenses/resistances) is already shape-aligned across every kind
// for a given System — see forge/js/lib/tables.js#getStatsForArchetype and
// crucible/js/lib/stats.js#deriveStats, both of which write through that
// System's own combatBindings/abilityField rather than a hardcoded shape —
// so there is nothing left to transform here. Everything else (a kind's own
// narrative/identity fields — Forge's identity/fourD/note, Crucible's own
// type/archetypeId/roleId/recipeFulfillment) carries through unchanged
// under its own native key. A field with no home on the target kind is
// harmless extra data (ignored by whatever Template doesn't bind to it),
// never force-mapped into an unrelated existing field on the target — see
// the "Full NPC/Monster/Character Interchangeability" plan's own "What this
// plan does NOT force-fit" section for the concrete reasoning (Forge's
// narrative `identity.archetype`, e.g. "Guard", and Crucible's own
// behavioral-strategy `archetypeId` share a name but are different
// concepts, and must never be resolved against each other).

// `id`/`createdAt`/`updated_at` are Library-item metadata, never body
// content, on every kind in this suite (matches Character/Location/Setting/
// Journal's own established convention — see persistDraft's own comment in
// workbench-character-view.js) — the caller always stamps its own fresh id.
// `locationId`/`rolls` are Forge NPC-specific bookkeeping (which Location
// this was generated for, the roll-audit trail) with no meaning once this
// record becomes a different kind.
const STRIPPED_KEYS = new Set(["id", "createdAt", "updated_at", "locationId", "rolls"]);

// `fromKind` isn't branched on today (nothing here differs by source kind
// yet) — kept in the signature because it's part of this function's stable,
// documented contract and makes call sites self-explanatory
// (`convertLibraryRecord(npc, {fromKind: "npc", toKind: "character", ...})`).
// A future NPC<->Monster direction may need it for real.
export function convertLibraryRecord(payload, { fromKind, toKind, systemId, templateId, name } = {}) {
  if (!payload || typeof payload !== "object") return null;
  const rest = {};
  Object.entries(payload).forEach(([key, value]) => {
    if (!STRIPPED_KEYS.has(key)) rest[key] = value;
  });

  if (toKind !== "character") {
    return rest;
  }

  // Character's own minimal envelope — mirrors workbench-character-view.js's
  // own startImportedCharacter draft shape exactly. `template` assignment
  // stays a required, explicit step (no kind has an implicit default
  // Template) — always supplied by the caller, resolved from whatever the
  // GM picked in the conversion modal.
  const characterName = name || payload.name || payload.title || "Converted Character";
  return {
    ...rest,
    title: characterName,
    template: templateId || "",
    systemIds: systemId ? [systemId] : Array.isArray(payload.systemIds) ? payload.systemIds : [],
    data: { name: characterName },
    state: { timers: {}, log: [] },
  };
}

// Seeds Character-only concepts (race/level/savingThrows/skills) a
// converted NPC/Monster carries no data for at all, so Workbench's
// Character template shows real, editable rows instead of nothing — the
// same "present but not accurately calculable" convention Forge's own
// generation already leans on for fields it can't roll with certainty (see
// forge/js/lib/generator.js#rollSkills). Purely additive: never overwrites
// a key the source record already carries under its own name. Stays a pure
// sync transform — `abilityDefs`/`skillDefs` are resolved by the caller
// (already has dataManager access for the Template picker) via
// generator-kit.js's loadAbilityFieldDefs/loadArrayFieldValues against the
// target System, and are empty for a System with no matching field (a
// System with no Level/Skills concept at all, e.g. Daggerheart) — every
// step below is inert in that case, exactly like every other "no field
// authored" fallback in this suite.
export function seedCharacterDefaults(payload, { abilityDefs = [], skillDefs = [], derivedFormulas = [] } = {}) {
  if (!payload || typeof payload !== "object") return payload;
  const identity = { ...(payload.identity || {}) };
  // NPC's own species (Forge's universal Identity layer — always the same
  // key regardless of System) maps onto Character's own race.name; harmless
  // extra data if this System's Template doesn't bind to race at all (see
  // this file's own header comment on unmapped fields).
  if (identity.species && !identity.race) {
    identity.race = { name: identity.species };
    delete identity.species;
  }
  // Every Character conventionally starts at level 1 — Forge/Crucible have
  // no level concept of their own to carry over, but an explicit 1 (not
  // left undefined) is what makes the Level field render as a real,
  // editable value instead of looking blank/missing.
  if (identity.level === undefined) identity.level = 1;

  const stats = { ...(payload.stats || {}) };
  const abilities = stats.abilities || {};
  const abilityModOf = (key) => evaluateDerivedFormula(derivedFormulas, "abilityModifier", { score: abilities[key] ?? 10 }) || 0;

  if (abilityDefs.length && !stats.savingThrows) {
    stats.savingThrows = abilityDefs.map((ability) => ({
      name: ability.key,
      friendlyName: ability.key.charAt(0).toUpperCase() + ability.key.slice(1),
      shortName: ability.label,
      // No proficiency data exists on an NPC/Monster to carry over — value
      // is the flat ability modifier, proficiency 0 (Novice), left for the
      // GM to actually set.
      value: abilityModOf(ability.key),
      proficiency: 0,
    }));
  }
  if (skillDefs.length && !stats.skills) {
    stats.skills = skillDefs.map((skill) => {
      const abilityDef = abilityDefs.find((entry) => entry.key === skill.ability);
      return {
        name: String(skill.name || "")
          .toLowerCase()
          .replace(/[^a-z0-9]+/g, "-")
          .replace(/(^-|-$)/g, ""),
        friendlyName: skill.name,
        ability: abilityDef?.label || "",
        value: abilityModOf(skill.ability),
        proficiency: 0,
      };
    });
  }

  return { ...payload, identity, stats };
}
