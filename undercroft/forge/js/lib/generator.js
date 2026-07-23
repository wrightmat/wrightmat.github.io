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

// Composes one full NPC roll (Identity + 4D) from a Location config and the
// loaded table set. `tables.speciesProfiles` must already be populated for
// this Location (see loadSpeciesProfilesForLocation in tables.js) since a
// single generation may need to resolve any blend partner in the
// population, not just the rolled primary species. `overrides` (species,
// archetype, alignment, gender) come from the left pane's manual-pick
// selects — any attribute set there is used as-is instead of rolled.
export function generateNpc(location, tables, { overrides = {}, random = Math.random } = {}) {
  const species = rollWeightedSpecies(location, tables.speciesProfiles, { random, override: overrides.species });
  const archetype = rollArchetype(tables.archetype, location, { random, override: overrides.archetype });
  const alignment = rollAlignment({ random, override: overrides.alignment });
  const gender = rollGender({ random, override: overrides.gender });
  const age = rollAge({ random });
  const relationship = rollRelationship({ random });
  const attitude = rollAttitude({ random });
  const fourD = rollFourD(tables.fourD, { random });
  const nameResult = generateSpeciesName(location, species.speciesId, tables.speciesProfiles, { random });

  return {
    locationId: location?.id ?? null,
    identity: {
      name: nameResult.name,
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
    stats: getStatsForArchetype(tables.stats, archetype.name),
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
// (rolls + resolved value both updated) without touching anything else —
// backs the per-attribute reroll buttons in the generator UI. Species and
// Name are linked (a name is generated *for* a species) so rerolling
// Species also regenerates Name, the same way rerolling Archetype also
// recomputes Stats — otherwise the two could end up visibly mismatched.
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
      next.identity.name = nameResult.name;
      next.rolls.name = nameResult;
      break;
    }
    case "name": {
      const speciesId = next.rolls.species?.speciesId;
      const nameResult = generateSpeciesName(location, speciesId, tables.speciesProfiles, { random });
      next.identity.name = nameResult.name;
      next.rolls.name = nameResult;
      break;
    }
    case "archetype": {
      const archetype = rollArchetype(tables.archetype, location, { random });
      next.identity.archetype = archetype.name;
      next.rolls.archetype = archetype;
      next.stats = getStatsForArchetype(tables.stats, archetype.name);
      break;
    }
    case "alignment": {
      const alignment = rollAlignment({ random });
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
      const attitude = rollAttitude({ random });
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
