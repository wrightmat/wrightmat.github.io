import { evaluateDerivedFormula } from "./derived-formulas.js";

// Converts a Library record's payload from one kind to another within the
// same System (Forge NPC -> Workbench Character, Crucible Monster ->
// Workbench Character). Deliberately NOT a per-pair mapping table: the
// combat-relevant subset is already shape-aligned across every kind for a
// given System (each generator writes through that System's own
// combatBindings/abilityField, never a hardcoded shape), so there's nothing
// to transform there. Everything else carries through unchanged under its
// own native key — a field with no home on the target kind is harmless
// extra data, never force-mapped onto an unrelated field (Forge's narrative
// `identity.archetype` and Crucible's behavioral `archetypeId` share a name
// but are different concepts and must never be resolved against each other).

// `id`/`createdAt`/`updated_at` are Library-item metadata, never body
// content — the caller always stamps its own fresh id. `locationId`/`rolls`
// are Forge NPC-specific bookkeeping with no meaning on another kind.
const STRIPPED_KEYS = new Set(["id", "createdAt", "updated_at", "locationId", "rolls"]);

// `fromKind` isn't branched on today — kept in the signature since it's part
// of this function's stable contract and makes call sites self-explanatory.
export function convertLibraryRecord(payload, { fromKind, toKind, systemId, templateId, name } = {}) {
  if (!payload || typeof payload !== "object") return null;
  const rest = {};
  Object.entries(payload).forEach(([key, value]) => {
    if (!STRIPPED_KEYS.has(key)) rest[key] = value;
  });

  if (toKind !== "character") {
    return rest;
  }

  // Mirrors workbench-character-view.js's startImportedCharacter draft
  // shape. `template` is always caller-supplied — no kind has an implicit
  // default Template.
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

// Seeds Character-only concepts (race/level/savingThrows/skills) a converted
// NPC/Monster carries no data for, so Workbench's Character template shows
// real editable rows instead of nothing. Purely additive: never overwrites a
// key the source already carries. A pure sync transform —
// `abilityDefs`/`skillDefs` are resolved by the caller via
// generator-kit.js's loadAbilityFieldDefs/loadArrayFieldValues, and are
// empty (every step below inert) for a System with no matching field.
export function seedCharacterDefaults(payload, { abilityDefs = [], skillDefs = [], derivedFormulas = [] } = {}) {
  if (!payload || typeof payload !== "object") return payload;
  const identity = { ...(payload.identity || {}) };
  // NPC's own species (Forge's universal Identity layer) maps onto
  // Character's race.name; harmless extra data if the Template doesn't bind
  // to race at all.
  if (identity.species && !identity.race) {
    identity.race = { name: identity.species };
    delete identity.species;
  }
  // Explicit 1, not undefined, so the Level field renders as a real editable
  // value rather than looking blank.
  if (identity.level === undefined) identity.level = 1;

  const stats = { ...(payload.stats || {}) };
  const abilities = stats.abilities || {};
  const abilityModOf = (key) => evaluateDerivedFormula(derivedFormulas, "abilityModifier", { score: abilities[key] ?? 10 }) || 0;

  if (abilityDefs.length && !stats.savingThrows) {
    stats.savingThrows = abilityDefs.map((ability) => ({
      name: ability.key,
      friendlyName: ability.key.charAt(0).toUpperCase() + ability.key.slice(1),
      shortName: ability.label,
      // No proficiency data exists on an NPC/Monster — flat modifier,
      // proficiency 0, left for the GM to set.
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
