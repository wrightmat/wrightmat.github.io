import {
  rollWeightedSpecies,
  rollAlignment,
  rollGender,
  rollAge,
  rollRelationship,
  rollAttitude,
  rollArchetype,
  rollFourD,
  getStatsForArchetype,
} from "./tables.js";
import { generateSpeciesName } from "./name-generator.js";

// A key this archetype's own entry doesn't already carry gets independently
// rolled within the System's own authored range (tables.independentStatRanges)
// instead of being left out — CoC's real case: Occupation entries only ever
// carry creditRatingMin/Max, so Characteristics and Hit Points/Move roll
// independently every time. A System whose entries already carry everything
// (D&D) has nothing left for this to fill in.
function rollIndependentStats(ranges, existingKeys, random) {
  const result = {};
  (ranges || []).forEach(({ key, min, max }) => {
    if (existingKeys.has(key)) return;
    result[key] = Math.round(min + random() * (max - min));
  });
  return result;
}

// Distinguishes "this System has no Stats concept bound at all" (Stats
// genuinely omitted from the record — undefined, since JSON.stringify drops
// undefined-valued keys) from "this System has Stats, but not for this
// particular archetype" (a real `stats: null`, rendered as "No stat block
// available" rather than silently disappearing).
function resolveStats(tables, archetypeName, random) {
  const hasStatsTable = tables.stats && Object.keys(tables.stats).length > 0;
  const independentRanges = tables.independentStatRanges || [];
  if (!hasStatsTable && !independentRanges.length) return undefined;
  const archetypeEntry = hasStatsTable ? tables.stats[archetypeName] : null;
  if (!archetypeEntry && !independentRanges.length) return null;
  const existingKeys = new Set(Object.keys(archetypeEntry || {}));
  const rolled = rollIndependentStats(independentRanges, existingKeys, random);
  const merged = { ...(archetypeEntry || {}), ...rolled };
  return getStatsForArchetype(
    { [archetypeName]: merged },
    archetypeName,
    tables.abilityKeys,
    tables.abilityFieldKey,
    tables.combatBindings,
    tables.derivedFormulas
  );
}

// A System-defined "Key Expertise Skills roll higher, everything else rolls
// lower" NPC skill generation — genuinely data-driven: the ranges and skill
// vocabulary all come from the System's own skillGeneration field, never
// hardcoded here. undefined for a System with no config authored.
function rollSkills(skillGeneration, random) {
  if (!skillGeneration) return undefined;
  const { skillKeys, keyCount, keyMin, keyMax, otherMin, otherMax } = skillGeneration;
  const pool = [...skillKeys];
  const keySkills = new Set();
  for (let i = 0; i < keyCount && pool.length; i += 1) {
    const index = Math.floor(random() * pool.length);
    keySkills.add(pool.splice(index, 1)[0].key);
  }
  const result = {};
  skillKeys.forEach(({ key }) => {
    const [min, max] = keySkills.has(key) ? [keyMin, keyMax] : [otherMin, otherMax];
    result[key] = Math.round(min + random() * (max - min));
  });
  return { keySkills: Array.from(keySkills), values: result };
}

// Composes one full NPC roll (Identity + 4D) from a Location config and the
// loaded table set. `tables.speciesProfiles` must already be populated for
// this Location, since a single generation may need to resolve any blend
// partner in the population, not just the rolled primary species.
// `overrides` come from the left pane's manual-pick selects. `systemId`/
// `settingId` stamp systemIds/settingIds so an NPC generated with no
// Location (optional) can still be found under the right Setting.
export function generateNpc(location, tables, { overrides = {}, random = Math.random, systemId = null, settingId = null } = {}) {
  const species = rollWeightedSpecies(location, tables.speciesProfiles, { random, override: overrides.species });
  const archetype = rollArchetype(tables.archetype, location, { random, override: overrides.archetype });
  const alignment = rollAlignment({ random, override: overrides.alignment, faces: tables.alignmentFaces });
  const gender = rollGender({ random, override: overrides.gender });
  const age = rollAge({ random });
  const relationship = rollRelationship({ random });
  const attitude = rollAttitude(tables.npcAttitudes, { random });
  const fourD = rollFourD(tables.fourD, { random });
  const nameResult = generateSpeciesName(location, species.speciesId, tables.speciesProfiles, { random });

  return {
    systemIds: systemId ? [systemId] : [],
    settingIds: settingId ? [settingId] : [],
    locationId: location?.id ?? null,
    name: nameResult.name,
    // Never rolled/generated — set manually afterward.
    image: "",
    identity: {
      species: species.label,
      archetype: archetype.name,
      alignment: alignment.label,
      gender: gender.label,
      age: age.label,
      relationship: relationship.label,
      attitude: attitude.value,
    },
    fourD: {
      description: fourD.description.label,
      demeanor: fourD.demeanor.label,
      drive: fourD.drive.label,
      direction: fourD.direction.label,
    },
    stats: resolveStats(tables, archetype.name, random),
    // Present only for a System with a skillGeneration config authored —
    // omitted entirely for every other System, same as `stats` above.
    skills: rollSkills(tables.skillGeneration, random),
    note: null,
    rolls: {
      species,
      archetype,
      alignment,
      gender,
      age,
      relationship,
      attitude,
      fourD,
      name: nameResult,
    },
  };
}

// Rerolls a single Identity/4D attribute in place, returning a new record
// without touching anything else. Species and Name are linked (a name is
// generated *for* a species) so rerolling Species also regenerates Name,
// same as rerolling Archetype also recomputes Stats — otherwise the two
// could end up visibly mismatched.
export function rerollAttribute(record, tables, location, attribute, { random = Math.random } = {}) {
  const next = {
    ...record,
    identity: { ...record.identity },
    fourD: { ...record.fourD },
    rolls: { ...record.rolls },
  };
  switch (attribute) {
    case "species": {
      const species = rollWeightedSpecies(location, tables.speciesProfiles, { random });
      next.identity.species = species.label;
      next.rolls.species = species;
      const nameResult = generateSpeciesName(location, species.speciesId, tables.speciesProfiles, { random });
      next.name = nameResult.name;
      next.rolls.name = nameResult;
      break;
    }
    case "name": {
      const speciesId = next.rolls.species?.speciesId;
      const nameResult = generateSpeciesName(location, speciesId, tables.speciesProfiles, { random });
      next.name = nameResult.name;
      next.rolls.name = nameResult;
      break;
    }
    case "archetype": {
      const archetype = rollArchetype(tables.archetype, location, { random });
      next.identity.archetype = archetype.name;
      next.rolls.archetype = archetype;
      next.stats = resolveStats(tables, archetype.name, random);
      next.skills = rollSkills(tables.skillGeneration, random);
      break;
    }
    case "alignment": {
      const alignment = rollAlignment({ random, faces: tables.alignmentFaces });
      next.identity.alignment = alignment.label;
      next.rolls.alignment = alignment;
      break;
    }
    case "gender": {
      const gender = rollGender({ random });
      next.identity.gender = gender.label;
      next.rolls.gender = gender;
      break;
    }
    case "age": {
      const age = rollAge({ random });
      next.identity.age = age.label;
      next.rolls.age = age;
      break;
    }
    case "relationship": {
      const relationship = rollRelationship({ random });
      next.identity.relationship = relationship.label;
      next.rolls.relationship = relationship;
      break;
    }
    case "attitude": {
      const attitude = rollAttitude(tables.npcAttitudes, { random });
      next.identity.attitude = attitude.value;
      next.rolls.attitude = attitude;
      break;
    }
    case "description":
    case "demeanor":
    case "drive":
    case "direction": {
      const fourD = rollFourD(tables.fourD, { random });
      next.fourD[attribute] = fourD[attribute].label;
      next.rolls.fourD = { ...next.rolls.fourD, [attribute]: fourD[attribute] };
      break;
    }
    default:
      break;
  }
  return next;
}
