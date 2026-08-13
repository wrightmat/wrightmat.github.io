// The core recipe/traversal generator. Unlike Forge's weighted-dice rolls
// against static tables, Crucible has no dice at all — a monster identity is
// built by filtering Library-backed `feature` entries against tag
// compatibility (Role/Creature Type) and a chosen Archetype's recipe (a
// signature slot, required slots, optional slots, and behavior tags to
// avoid), then traversing feature-to-feature synergy/conflict relationships
// to fill that recipe out with a coherent, non-contradictory feature set.

function pickRandom(list, random) {
  if (!list.length) return null;
  return list[Math.floor(random() * list.length)];
}

// `mechanics.scope: "unique"` is a Feature-author's own explicit "never
// hand this to a DIFFERENT monster" decision (a confirmed-irreducible
// creature-specific ability, or something inherently one-off like a named
// boss move) — distinct from an untagged Feature's empty `recipeSlots`,
// which already excludes it from candidatesForSlot's own slot-membership
// check but only as a side effect of nobody having reviewed it yet, not a
// recorded decision. Checked here (the one choke point both
// candidatesForSlot's normal traversal AND rerollAttribute's own signature-
// feature reroll already call through isCompatible) so a unique-scoped
// Feature can never be handed to generation via either path, independent
// of whether recipeSlots also happens to be populated.
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

// A feature with no categories tag is treated as universally compatible
// (the suite-wide "no tag means unconstrained" convention); otherwise it
// must claim "monster" — same pattern Sanctum's own matchesCategory uses
// for "location" and Vault's for "spell"/"item". Confirmed missing here
// entirely: the shared `feature` kind (undercroft/README.md's own
// Resource/Location Type conventions section covers its siblings) serves
// all three generators from ONE pool, and without this check Crucible's own
// generation — and its Locked/Add-feature pickers — pulled in Sanctum's
// location features and Vault's spell/item features right alongside its
// own monster ones.
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

/**
 * generateMonster(allCreatureTypes, allArchetypes, allRoles, allFeatures, options)
 *
 * Creature Type / Archetype / Role are all optional overrides (blank/undefined
 * = "Random"), exactly like Forge's Species/Archetype/Alignment/Gender
 * selects — pinning one narrows generation, leaving it blank just means the
 * generator resolves a concrete value for it itself before the recipe step.
 */
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

  const creatureType = (creatureTypeId && eligibleCreatureTypes.find((entry) => entry.id === creatureTypeId))
    || pickRandom(eligibleCreatureTypes, random);
  const archetype = (archetypeId && eligibleArchetypes.find((entry) => entry.id === archetypeId))
    || pickRandom(eligibleArchetypes, random);
  const role = (roleId && eligibleRoles.find((entry) => entry.id === roleId)) || pickRandom(eligibleRoles, random);

  if (!creatureType || !archetype || !role) {
    throw new Error("Not enough Creature Type/Archetype/Role reference data to generate a monster.");
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
    const candidates = candidatesForSlot(features, recipe.signatureSlot, role.id, creatureType.id, avoidTags, excludeIds);
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
    const picked = resolveSlot(features, slot, role.id, creatureType.id, avoidTags, selected, random);
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
    const picked = resolveSlot(features, slot, role.id, creatureType.id, avoidTags, selected, random);
    recipeFulfillment.optionalSlots[slot] = picked ? picked.id : null;
    if (picked) selected.push(picked);
  });

  return {
    systemIds: systemId ? [systemId] : [],
    // "type", not "creatureTypeId" — the stored value (e.g. "ooze") is a
    // description, not an opaque id, and this suite's own DDB/Fantasy
    // Statblocks monster-import mappings both already call the same concept
    // "type" (see ddb-monster.json/fantasy-statblocks-monster.json). Kept
    // as a top-level field (not nested in `stats` like those two) since
    // this is still Crucible's own generation-axis reference, same
    // "produced fresh at generation time" category as archetypeId/roleId
    // right below it — only its NAME changed, matching the user's own
    // explicit ask, not its place in the schema.
    type: creatureType.id,
    archetypeId: archetype.id,
    roleId: role.id,
    signatureFeatureId: signatureFeature ? signatureFeature.id : null,
    featureIds: selected.map((entry) => entry.id),
    recipeFulfillment,
    notes: "",
  };
}

// Rerolls a single Identity axis in place, returning a new record — backs
// the per-attribute reroll buttons in Identity (mirrors Forge's own
// rerollAttribute, forge/js/lib/generator.js). Deliberately does NOT
// re-run recipe/feature traversal for type/archetypeId/roleId — same
// restraint Forge's own reroll applies to everything except its one
// tightly-coupled species→name pair, rather than cascading into a much
// bigger, more surprising re-derivation of the whole feature list just
// because one axis changed. Signature Feature is the one field that DOES
// touch featureIds, since it's a member of that list, not a separate value
// (see generateMonster above) — rerolling it swaps the old entry for the
// new one in place rather than leaving a stale id behind.
export function rerollAttribute(record, { creatureTypes, archetypes, roles, features }, systemId, key, { random = Math.random } = {}) {
  function rerollFrom(list, currentId) {
    const eligible = list.filter((entry) => matchesSystem(entry, systemId));
    const excludingCurrent = eligible.filter((entry) => entry.id !== currentId);
    return pickRandom(excludingCurrent.length ? excludingCurrent : eligible, random);
  }

  if (key === "type") {
    const pick = rerollFrom(creatureTypes, record.type);
    return pick ? { ...record, type: pick.id } : record;
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
