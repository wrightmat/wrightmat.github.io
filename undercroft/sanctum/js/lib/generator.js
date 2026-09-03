// Sanctum has no recipe slots (Crucible) and no budget economy (Vault) — Feature
// and Resource selection is a plain tag-compatible, synergy-weighted pick: filter
// candidates to ones compatible with the resolved Type/Purpose/Environment, then
// repeatedly add whichever remaining candidate has the strongest synergy with what's
// already selected, until a small randomized target count is reached or nothing else
// qualifies. Assets/Needs reuse the exact same tag-compatibility filter against the
// `resource` kind instead of `feature`.

function pickRandom(list, random) {
  if (!list.length) return null;
  return list[Math.floor(random() * list.length)];
}

function matchesSystem(entity, systemId) {
  if (!systemId) return true;
  const ids = Array.isArray(entity.systemIds) ? entity.systemIds : [];
  return !ids.length || ids.includes(systemId);
}

// Same convention as matchesSystem — a Resource with no settingIds is
// universally available; a non-empty array restricts it to those Settings.
function matchesSetting(entity, settingId) {
  if (!settingId) return true;
  const ids = Array.isArray(entity.settingIds) ? entity.settingIds : [];
  return !ids.length || ids.includes(settingId);
}

// A feature with no categories tag is universally compatible; otherwise it
// must claim "location". Exported so app.js's own module-level `features`
// pickers (Locked Features, Add Feature) apply the same filter as
// generateLocation below, not the raw unfiltered fetch.
export function matchesCategory(feature) {
  const categories = feature.tags?.categories;
  if (!Array.isArray(categories) || !categories.length) return true;
  return categories.includes("location");
}

// Shared by Features and Resources — an empty tag array on any axis means
// universally compatible with that axis, Crucible's roles/creatureTypes convention.
function matchesLocationTags(entry, typeId, purposeId, environment) {
  const tags = entry.tags || {};
  const types = Array.isArray(tags.locationTypes) ? tags.locationTypes : [];
  const purposes = Array.isArray(tags.locationPurposes) ? tags.locationPurposes : [];
  const environments = Array.isArray(tags.environments) ? tags.environments : [];
  if (types.length && typeId && !types.includes(typeId)) return false;
  if (purposes.length && purposeId && !purposes.includes(purposeId)) return false;
  if (environments.length && environment && !environments.includes(environment)) return false;
  return true;
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

function conflictsWithSelected(feature, selected) {
  const selectedIds = new Set(selected.map((entry) => entry.id));
  if ((feature.conflictsWith || []).some((id) => selectedIds.has(id))) return true;
  return selected.some((entry) => (entry.conflictsWith || []).includes(feature.id));
}

// A Resource can declare conflictsWith against Feature ids, checked
// bidirectionally like feature-to-feature conflicts. Gates the ASSET pool
// only — a resource contradicting an already-selected Feature (e.g.
// "Polluted Waters") is exactly the kind of thing that belongs as a Need
// instead, so Needs are deliberately left unfiltered by this check.
function conflictsWithFeatures(resource, selectedFeatures) {
  const selectedFeatureIds = new Set(selectedFeatures.map((feature) => feature.id));
  if ((resource.conflictsWith || []).some((id) => selectedFeatureIds.has(id))) return true;
  return selectedFeatures.some((feature) => (feature.conflictsWith || []).includes(resource.id));
}

// Prefers positive-synergy candidates (bestScore below), but falls back to
// any compatible, non-conflicting candidate once nothing synergizes —
// without this, traversal routinely stalled after 1-2 Features against a
// small starter library where few candidates ever synergized with the seed.
// Returns null once nothing qualifies at all.
function pickNextFeature(eligibleFeatures, selected, random) {
  const selectedIds = new Set(selected.map((entry) => entry.id));
  const scored = [];
  for (const candidate of eligibleFeatures) {
    if (selectedIds.has(candidate.id)) continue;
    if (conflictsWithSelected(candidate, selected)) continue;
    scored.push({ entry: candidate, score: synergyScore(candidate, selected) });
  }
  if (!scored.length) return null;
  const bestScore = Math.max(...scored.map((entry) => entry.score));
  const best = scored.filter((entry) => entry.score === bestScore);
  return pickRandom(best, random).entry;
}

// `widerFeatures` is the same System+category pool with Type/Purpose/
// Environment tag-filtering dropped — the fallback whenever tag-matched
// `eligibleFeatures` has nothing left (a starter library sized in the
// dozens can't densely cover every Type x Purpose x Environment combination).
function selectFeatures(eligibleFeatures, widerFeatures, lockedFeatures, random) {
  const selected = [...lockedFeatures];
  if (!selected.length) {
    const seed = pickRandom(eligibleFeatures, random) || pickRandom(widerFeatures, random);
    if (seed) selected.push(seed);
  }
  if (!selected.length) return selected;
  const targetCount = 2 + Math.floor(random() * 3); // 2, 3, or 4
  while (selected.length < targetCount) {
    const next = pickNextFeature(eligibleFeatures, selected, random) || pickNextFeature(widerFeatures, selected, random);
    if (!next) break;
    selected.push(next);
  }
  return selected;
}

// Picks up to `count` distinct entries, excluding whatever's in `excludeIds` (so
// Needs never repeats what Assets already picked).
function pickDistinctResources(eligibleResources, count, excludeIds, random) {
  const excluded = new Set(excludeIds);
  const picks = [];
  for (let i = 0; i < count; i += 1) {
    const candidates = eligibleResources.filter((entry) => !excluded.has(entry.id));
    const picked = pickRandom(candidates, random);
    if (!picked) break;
    picks.push(picked);
    excluded.add(picked.id);
  }
  return picks;
}

// Expands `picks` into every id counting as "the same Resource" for exclusion
// purposes — each pick's own id, plus (per the `family` convention in
// undercroft/README.md) every other entry in `pool` sharing a non-empty
// `family` (different sizes/variants of the same underlying Resource, e.g.
// every `res.dragonshard-*`), so a place doesn't both have and need "the same thing."
function resourceExclusionIds(pool, picks) {
  const ids = new Set(picks.map((entry) => entry.id));
  const families = new Set(picks.map((entry) => entry.family).filter(Boolean));
  if (families.size) {
    pool.forEach((entry) => {
      if (entry.family && families.has(entry.family)) ids.add(entry.id);
    });
  }
  return ids;
}

// Rerolls a single Identity axis (Type/Purpose/Environment) — backs the
// per-field reroll button, mirroring Forge's/Crucible's/Vault's own
// per-attribute reroll. Deliberately does NOT re-run Feature/Resource
// traversal, same restraint those tools' own reroll applies.
export function rerollAxis(record, { locationTypes, locationPurposes, environmentPropertyType }, systemId, key, { random = Math.random } = {}) {
  function rerollFrom(list, currentId) {
    const eligible = list.filter((entry) => matchesSystem(entry, systemId));
    const excludingCurrent = eligible.filter((entry) => entry.id !== currentId);
    return pickRandom(excludingCurrent.length ? excludingCurrent : eligible, random);
  }

  if (key === "typeId") {
    const pick = rerollFrom(locationTypes, record.typeId);
    return pick ? { ...record, typeId: pick.id } : record;
  }
  if (key === "purposeId") {
    const pick = rerollFrom(locationPurposes, record.purposeId);
    return pick ? { ...record, purposeId: pick.id } : record;
  }
  if (key === "environment") {
    const values = environmentPropertyType?.values || [];
    const eligible = values.filter((value) => value.id !== record.environment);
    const pick = pickRandom(eligible.length ? eligible : values, random);
    return pick ? { ...record, environment: pick.id } : record;
  }
  return record;
}

/**
 * generateLocation(locationTypes, locationPurposes, features, resources, options)
 *
 * `systemId`/`settingId` are supplied by the caller (a Location always belongs to a
 * specific, GM-chosen Setting — never randomized). Type/Purpose/Environment are
 * optional overrides (blank = random). `environmentPropertyType` is the active
 * System's "environment"-keyed generator-property field (translated by app.js's
 * loadEnvironmentPropertyType), or null if the System doesn't define one.
 */
export function generateLocation(locationTypes, locationPurposes, features, resources, options = {}) {
  const {
    systemId = null,
    settingId = null,
    typeId = "",
    purposeId = "",
    environment = "",
    lockedFeatureIds = [],
    environmentPropertyType = null,
    random = Math.random,
  } = options;

  const eligibleTypes = locationTypes.filter((entry) => matchesSystem(entry, systemId));
  const eligiblePurposes = locationPurposes.filter((entry) => matchesSystem(entry, systemId));

  const resolvedType = (typeId && eligibleTypes.find((entry) => entry.id === typeId)) || pickRandom(eligibleTypes, random);
  const resolvedPurpose =
    (purposeId && eligiblePurposes.find((entry) => entry.id === purposeId)) || pickRandom(eligiblePurposes, random);

  let resolvedEnvironment = environment || "";
  if (!resolvedEnvironment && environmentPropertyType) {
    const value = pickRandom(environmentPropertyType.values || [], random);
    resolvedEnvironment = value ? value.id : "";
  }

  const resolvedTypeId = resolvedType ? resolvedType.id : "";
  const resolvedPurposeId = resolvedPurpose ? resolvedPurpose.id : "";

  const eligibleFeatures = features.filter(
    (feature) =>
      matchesSystem(feature, systemId) &&
      matchesCategory(feature) &&
      matchesLocationTags(feature, resolvedTypeId, resolvedPurposeId, resolvedEnvironment)
  );
  // Every location-category Feature for this System regardless of tags —
  // selectFeatures' own fallback pool for the common case where a specific
  // Type x Purpose x Environment combination has zero tag-matching Features.
  const allLocationFeatures = features.filter((feature) => matchesSystem(feature, systemId) && matchesCategory(feature));
  const eligibleResources = resources.filter(
    (resource) =>
      matchesSystem(resource, systemId) &&
      matchesSetting(resource, settingId) &&
      matchesLocationTags(resource, resolvedTypeId, resolvedPurposeId, resolvedEnvironment)
  );
  // Same widening as allLocationFeatures above, for Assets/Needs.
  const allLocationResources = resources.filter((resource) => matchesSystem(resource, systemId) && matchesSetting(resource, settingId));

  const lockedFeatures = lockedFeatureIds
    .map((id) => eligibleFeatures.find((entry) => entry.id === id) || allLocationFeatures.find((entry) => entry.id === id))
    .filter(Boolean);
  const selectedFeatures = selectFeatures(eligibleFeatures, allLocationFeatures, lockedFeatures, random);

  const assetSourcePool = eligibleResources.length ? eligibleResources : allLocationResources;
  const assetCandidates = assetSourcePool.filter((resource) => !conflictsWithFeatures(resource, selectedFeatures));
  const assetPicks = pickDistinctResources(assetCandidates, 1 + Math.floor(random() * 3), new Set(), random);
  const assets = assetPicks.map((entry) => ({ kind: "resource", refId: entry.id, label: entry.name || entry.id }));

  // Needs draw from the FULL source pool, not assetCandidates — a resource
  // conflicting with a selected Feature as an Asset is plausible as a Need
  // instead. Two extra restrictions: a `category: "service"` Resource never
  // Needs-in for "commerce" (a shop doesn't Need the service it sells), and
  // is otherwise rare as a Need (one coin flip per Location, not per
  // candidate, so a "yes" doesn't flood the pool). Commerce locations can
  // also land on zero Needs entirely, unlike every other Purpose's 1-3 range.
  const needsAllowServices = resolvedPurposeId !== "commerce" && random() < 0.15;
  const needSourcePool = eligibleResources.length ? eligibleResources : allLocationResources;
  const needCandidatePool = needSourcePool.filter((resource) => needsAllowServices || resource.category !== "service");
  const needExcludeIds = resourceExclusionIds(needCandidatePool, assetPicks);
  const needsTargetCount = resolvedPurposeId === "commerce" ? Math.floor(random() * 2) : 1 + Math.floor(random() * 3);
  const needPicks = pickDistinctResources(needCandidatePool, needsTargetCount, needExcludeIds, random);
  const needs = needPicks.map((entry) => ({ kind: "resource", refId: entry.id, label: entry.name || entry.id }));

  // Absolute last resort — every Location should have SOMETHING going on.
  // Only fires when this System's location-category libraries are
  // themselves essentially empty (a brand-new homebrew System). Prefers a
  // Feature over an Asset; if neither exists, the Location stays empty.
  if (!selectedFeatures.length && !assets.length && !needs.length) {
    const forcedFeature = pickRandom(allLocationFeatures, random);
    if (forcedFeature) {
      selectedFeatures.push(forcedFeature);
    } else {
      const forcedResource = pickRandom(allLocationResources, random);
      if (forcedResource) {
        assets.push({ kind: "resource", refId: forcedResource.id, label: forcedResource.name || forcedResource.id });
      }
    }
  }

  return {
    systemIds: systemId ? [systemId] : [],
    settingIds: settingId ? [settingId] : [],
    typeId: resolvedTypeId || null,
    purposeId: resolvedPurposeId || null,
    environment: resolvedEnvironment || null,
    featureIds: selectedFeatures.map((entry) => entry.id),
    assets,
    needs,
    // Containment/adjacency are `relationship` records now, added
    // deliberately by the GM afterward — never generated here.
    notes: "",
  };
}
