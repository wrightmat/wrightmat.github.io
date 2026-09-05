// No dice — a monster identity is built by filtering Library-backed `feature`
// entries against tag compatibility (Role/Creature Type) and a chosen
// Archetype's recipe (signature slot, required/optional slots, avoid tags),
// then traversing feature synergy/conflict relationships to fill it out.

function pickRandom(list, random) {
  if (!list.length) return null;
  return list[Math.floor(random() * list.length)];
}

// `mechanics.scope: "unique"` is a Feature-author's explicit "never hand
// this to a different monster" flag (a named boss move, etc.) — checked here
// since both candidatesForSlot and rerollAttribute's signature reroll call
// through isCompatible, so a unique-scoped Feature can never reach either path.
function isCompatible(feature, roleId, creatureTypeId) {
  if (feature.mechanics?.scope === "unique") return false;
  const tags = feature.tags || {};
  const roles = Array.isArray(tags.roles) ? tags.roles : [];
  const creatureTypes = Array.isArray(tags.creatureTypes) ? tags.creatureTypes : [];
  if (roles.length && !roles.includes(roleId)) return false;
  if (creatureTypes.length && !creatureTypes.includes(creatureTypeId)) return false;
  return true;
}

function matchesSystem(entity, systemId) {
  if (!systemId) return true;
  const ids = Array.isArray(entity.systemIds) ? entity.systemIds : [];
  return !ids.length || ids.includes(systemId);
}

// The shared `feature` kind serves Crucible/Sanctum/Vault from one pool —
// without this check, generation (and the Locked/Add-feature pickers) pulled
// in Sanctum's location features and Vault's spell/item features too. No
// categories tag = universally compatible; otherwise must claim "monster".
export function matchesCategory(feature) {
  const categories = feature.tags?.categories;
  if (!Array.isArray(categories) || !categories.length) return true;
  return categories.includes("monster");
}

function candidatesForSlot(features, slot, roleId, creatureTypeId, avoidTags, excludeIds) {
  return features.filter((feature) => {
    if (excludeIds.has(feature.id)) return false;
    const slots = feature.tags?.recipeSlots || [];
    if (!slots.includes(slot)) return false;
    if (!isCompatible(feature, roleId, creatureTypeId)) return false;
    const behaviors = feature.tags?.behaviors || [];
    if (behaviors.some((tag) => avoidTags.has(tag))) return false;
    return true;
  });
}

function conflictsWithSelected(feature, selected) {
  const selectedIds = new Set(selected.map((entry) => entry.id));
  if (feature.conflictsWith?.some((id) => selectedIds.has(id))) return true;
  return selected.some((entry) => (entry.conflictsWith || []).includes(feature.id));
}

function synergyScore(feature, selected) {
  const selectedIds = new Set(selected.map((entry) => entry.id));
  let score = 0;
  (feature.synergizesWith || []).forEach((id) => {
    if (selectedIds.has(id)) score += 1;
  });
  selected.forEach((entry) => {
    if ((entry.synergizesWith || []).includes(feature.id)) score += 1;
  });
  return score;
}

// Picks the best-scoring, non-conflicting candidate for a slot: prefers
// mutual synergy with whatever's already selected, falls back to any
// compatible, non-conflicting candidate, and only leaves the slot
// unfulfilled if literally nothing qualifies.
function resolveSlot(features, slot, roleId, creatureTypeId, avoidTags, selected, random) {
  const excludeIds = new Set(selected.map((entry) => entry.id));
  const candidates = candidatesForSlot(features, slot, roleId, creatureTypeId, avoidTags, excludeIds).filter(
    (feature) => !conflictsWithSelected(feature, selected)
  );
  if (!candidates.length) return null;
  const bestScore = Math.max(...candidates.map((feature) => synergyScore(feature, selected)));
  const best = candidates.filter((feature) => synergyScore(feature, selected) === bestScore);
  return pickRandom(best, random);
}

// Mirrors generateMonster's own eligibility filtering exactly so the
// Generate button's disabled state and its throw condition can't drift apart.
// Creature Type isn't checked — it's optional, same as in generateMonster.
export function getMonsterGenerationBlockReason(allCreatureTypes, allArchetypes, allRoles, options = {}) {
  const { systemId = null } = options;
  const missing = [];
  if (!allArchetypes.some((entry) => matchesSystem(entry, systemId))) missing.push("Archetype");
  if (!allRoles.some((entry) => matchesSystem(entry, systemId))) missing.push("Role");
  if (!missing.length) return null;
  return `Not enough ${missing.join("/")} reference data to generate a monster.`;
}

// Creature Type/Archetype/Role are optional overrides (blank = "Random");
// pinning one narrows generation, leaving it blank resolves it internally.
export function generateMonster(allCreatureTypes, allArchetypes, allRoles, allFeatures, options = {}) {
  const {
    systemId = null,
    creatureTypeId = "",
    archetypeId = "",
    roleId = "",
    signatureFeatureId = "",
    lockedFeatureIds = [],
    random = Math.random,
  } = options;

  const eligibleCreatureTypes = allCreatureTypes.filter((entry) => matchesSystem(entry, systemId));
  const eligibleArchetypes = allArchetypes.filter((entry) => matchesSystem(entry, systemId));
  const eligibleRoles = allRoles.filter((entry) => matchesSystem(entry, systemId));

  const creatureType = (creatureTypeId && eligibleCreatureTypes.find((entry) => entry.shortName === creatureTypeId))
    || pickRandom(eligibleCreatureTypes, random);
  const archetype = (archetypeId && eligibleArchetypes.find((entry) => entry.id === archetypeId))
    || pickRandom(eligibleArchetypes, random);
  const role = (roleId && eligibleRoles.find((entry) => entry.id === roleId)) || pickRandom(eligibleRoles, random);

  // Creature Type is optional (a System like Daggerheart may not define one)
  // — `type` just comes out null. Archetype and Role are the only hard
  // requirements, since without them there's no recipe to traverse.
  if (!archetype || !role) {
    throw new Error("Not enough Archetype/Role reference data to generate a monster.");
  }

  const recipe = archetype.recipe || {};
  const avoidTags = new Set(recipe.avoidTags || []);
  const features = allFeatures.filter((entry) => matchesSystem(entry, systemId) && matchesCategory(entry));

  const lockedFeatures = lockedFeatureIds
    .map((id) => features.find((entry) => entry.id === id))
    .filter(Boolean);

  let signatureFeature = signatureFeatureId
    ? features.find((entry) => entry.id === signatureFeatureId)
    : null;
  if (!signatureFeature && recipe.signatureSlot) {
    const excludeIds = new Set(lockedFeatures.map((entry) => entry.id));
    const candidates = candidatesForSlot(features, recipe.signatureSlot, role.id, creatureType?.shortName, avoidTags, excludeIds);
    signatureFeature = pickRandom(candidates, random);
  }

  const selected = [...lockedFeatures];
  if (signatureFeature && !selected.some((entry) => entry.id === signatureFeature.id)) {
    selected.unshift(signatureFeature);
  }

  const recipeFulfillment = {
    signatureSlot: signatureFeature ? "filled" : "unfulfilled",
    requiredSlots: {},
    optionalSlots: {},
  };

  (recipe.requiredSlots || []).forEach((slot) => {
    const already = selected.find((entry) => (entry.tags?.recipeSlots || []).includes(slot));
    if (already) {
      recipeFulfillment.requiredSlots[slot] = already.id;
      return;
    }
    const picked = resolveSlot(features, slot, role.id, creatureType?.shortName, avoidTags, selected, random);
    if (picked) {
      selected.push(picked);
      recipeFulfillment.requiredSlots[slot] = picked.id;
    } else {
      recipeFulfillment.requiredSlots[slot] = null;
    }
  });

  (recipe.optionalSlots || []).forEach((slot) => {
    const already = selected.find((entry) => (entry.tags?.recipeSlots || []).includes(slot));
    if (already) {
      recipeFulfillment.optionalSlots[slot] = already.id;
      return;
    }
    const picked = resolveSlot(features, slot, role.id, creatureType?.shortName, avoidTags, selected, random);
    recipeFulfillment.optionalSlots[slot] = picked ? picked.id : null;
    if (picked) selected.push(picked);
  });

  return {
    systemIds: systemId ? [systemId] : [],
    // "type", not "creatureTypeId" — matches the import mappings' own name
    // for this concept. Stays top-level (not nested in `stats`) since it's
    // still one of Crucible's own generation-axis fields, alongside
    // archetypeId/roleId below.
    type: creatureType?.shortName ?? null,
    archetypeId: archetype.id,
    roleId: role.id,
    signatureFeatureId: signatureFeature ? signatureFeature.id : null,
    featureIds: selected.map((entry) => entry.id),
    recipeFulfillment,
    notes: "",
  };
}

// Rerolls a single Identity axis in place. Deliberately does NOT re-run
// recipe/feature traversal for type/archetypeId/roleId — rerolling one axis
// shouldn't cascade into re-deriving the whole feature list. Signature
// Feature is the exception: it's a member of featureIds, not a separate
// value, so rerolling it swaps the old entry for the new one in place.
export function rerollAttribute(record, { creatureTypes, archetypes, roles, features }, systemId, key, { random = Math.random } = {}) {
  function rerollFrom(list, currentId, idKey = "id") {
    const eligible = list.filter((entry) => matchesSystem(entry, systemId));
    const excludingCurrent = eligible.filter((entry) => entry[idKey] !== currentId);
    return pickRandom(excludingCurrent.length ? excludingCurrent : eligible, random);
  }

  if (key === "type") {
    const pick = rerollFrom(creatureTypes, record.type, "shortName");
    return pick ? { ...record, type: pick.shortName } : record;
  }
  if (key === "archetypeId") {
    const pick = rerollFrom(archetypes, record.archetypeId);
    return pick ? { ...record, archetypeId: pick.id } : record;
  }
  if (key === "roleId") {
    const pick = rerollFrom(roles, record.roleId);
    return pick ? { ...record, roleId: pick.id } : record;
  }
  if (key === "signatureFeatureId") {
    const eligibleFeatures = features.filter(
      (entry) => matchesSystem(entry, systemId) && matchesCategory(entry) && entry.id !== record.signatureFeatureId
    );
    const compatible = eligibleFeatures.filter((entry) => isCompatible(entry, record.roleId, record.type));
    const pick = pickRandom(compatible.length ? compatible : eligibleFeatures, random);
    if (!pick) return record;
    const featureIds = (record.featureIds || []).filter((id) => id !== record.signatureFeatureId);
    if (!featureIds.includes(pick.id)) featureIds.unshift(pick.id);
    return { ...record, signatureFeatureId: pick.id, featureIds };
  }
  return record;
}
