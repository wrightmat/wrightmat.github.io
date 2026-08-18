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

// Same convention as matchesSystem — a Resource with no settingIds (or an
// empty array) is universally available; a non-empty array restricts it to
// exactly those Settings (e.g. Eberron-flavored goods/services shouldn't
// show up when generating a Location in a different Setting).
function matchesSetting(entity, settingId) {
  if (!settingId) return true;
  const ids = Array.isArray(entity.settingIds) ? entity.settingIds : [];
  return !ids.length || ids.includes(settingId);
}

// A feature with no categories tag is treated as universally compatible (the
// suite-wide "no tag means unconstrained" convention); otherwise it must claim
// "location". Exported (not just used internally by generateLocation below)
// so app.js's own reloadReferenceData can apply the identical filter to the
// module-level `features` list its own UI pickers (Locked Features, Add
// Feature) read from — confirmed the exact same category-leak bug already
// fixed in Crucible's/Vault's own equivalents, just never applied here:
// generateLocation's own pool was already filtered, but the picker UI read
// straight from the raw, unfiltered fetch, leaking monster/spell/item
// features into Sanctum's own Features list.
export function matchesCategory(feature) {
  const categories = feature.tags?.categories;
  if (!Array.isArray(categories) || !categories.length) return true;
  return categories.includes("location");
}

// Shared by both Features and Resources — an empty tag array on any of the three
// axes means universally compatible with that axis, exactly Crucible's
// roles/creatureTypes convention.
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

// A Resource can declare conflictsWith against Feature ids (e.g. "Clean
// Water" conflicts with "Polluted Waters") — checked the same bidirectional
// way as feature-to-feature conflicts, so either side can declare the
// relationship. This only ever gates the ASSET pool: a resource that
// contradicts an already-selected Feature as something the location *has*
// is exactly the kind of thing that instead belongs in Needs (a place with
// Polluted Waters plausibly *needs* Clean Water — that's the point of a
// Need, not a contradiction), so Needs are deliberately left unfiltered by
// this check.
function conflictsWithFeatures(resource, selectedFeatures) {
  const selectedFeatureIds = new Set(selectedFeatures.map((feature) => feature.id));
  if ((resource.conflictsWith || []).some((id) => selectedFeatureIds.has(id))) return true;
  return selectedFeatures.some((feature) => (feature.conflictsWith || []).includes(resource.id));
}

// Prefers a candidate with positive synergy to what's already selected, but
// — unlike an earlier version of this function, which refused to add
// anything scoring zero at all — falls back to any compatible,
// non-conflicting candidate when nothing synergizes, the same restraint
// Crucible's own resolveSlot already applies. Confirmed real bug the old
// behavior caused: with no slots forcing a fill here, and typically only a
// couple of the small starter feature set actually synergizing with any
// given seed, traversal routinely stopped after just one or two Features —
// nowhere near even the small 2-4 targetCount below, let alone leaving a
// Location with "nothing going on" whenever the very first seed pick had no
// synergy partners at all. Positive-synergy candidates still win over
// zero-synergy ones whenever both exist (bestScore below), so this doesn't
// make selection less thematically coherent when a real synergistic option
// is actually available — it only kicks in once nothing else is. Returns
// null once nothing qualifies at all (every candidate's used, conflicting,
// or the pool was empty to begin with).
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
// Environment tag-filtering dropped — the fallback whenever the tag-matched
// `eligibleFeatures` has nothing left to offer, for both the initial seed
// and every step of the fill loop below (see generateLocation's own comment
// on allLocationFeatures for why this fallback exists at all).
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

// Expands `picks` into every id that counts as "the same Resource" for
// exclusion purposes — each pick's own id, plus (per the documented
// `family` convention in undercroft/README.md's Resource conventions) every
// OTHER entry in `pool` sharing a pick's non-empty `family`. Different
// sizes/variants of the same underlying Resource (e.g. every
// `res.dragonshard-*` sharing `family: "dragonshard"`) are different ids but
// still shouldn't let a place both have and need "the same thing."
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
// per-field reroll button next to Sanctum's own Identity selects, mirroring
// Forge's/Crucible's/Vault's own per-attribute reroll. Deliberately does NOT
// re-run Feature/Resource traversal — same restraint those tools' own reroll
// applies, rather than cascading into a much bigger, more surprising
// re-derivation of the whole Features/Assets/Needs list just because one
// axis changed.
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
 * optional overrides (blank = random, the established convention). `environmentPropertyType`
 * is the active System's "environment"-keyed generator-property field (an ordinary array
 * field on the System's `fields`, translated by app.js's loadEnvironmentPropertyType), or
 * null if the System doesn't define one, in which case Environment stays unresolved and no
 * environment-tag filtering applies.
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
  // Every location-category Feature for this System, regardless of Type/
  // Purpose/Environment tags — selectFeatures' own fallback pool for when
  // tag-filtering leaves nothing (a real, common outcome: a starter library
  // sized in the dozens can't densely cover the full Type x Purpose x
  // Environment combination space, so plenty of specific combinations have
  // zero tag-matching Features). Confirmed real bug this fixes, alongside
  // pickNextFeature's own relaxed synergy rule above: a Location generated
  // for an under-covered combination used to come back with literally
  // nothing — no Feature, and (see below) often no Asset/Need either.
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

  // Falls back to the widened pool the same way selectFeatures does above,
  // when the tag-filtered one has nothing to offer.
  const assetSourcePool = eligibleResources.length ? eligibleResources : allLocationResources;
  const assetCandidates = assetSourcePool.filter((resource) => !conflictsWithFeatures(resource, selectedFeatures));
  const assetPicks = pickDistinctResources(assetCandidates, 1 + Math.floor(random() * 3), new Set(), random);
  const assets = assetPicks.map((entry) => ({ kind: "resource", refId: entry.id, label: entry.name || entry.id }));

  // Needs are deliberately drawn from the FULL source pool (not
  // assetCandidates) — a resource that conflicts with a selected Feature as
  // an Asset is exactly the kind of thing that's plausible as a Need instead
  // — but two more restrictions apply on top of that pool:
  // - A `category: "service"` Resource (see undercroft/README.md's Resource
  //   conventions) never Needs-in for "commerce" (the shared starter
  //   Purpose id — a shop) at all: a place that sells things doesn't Need a
  //   service the way it might Need raw goods. Outside Commerce, a Service
  //   is still comparatively rare as a Need, so it's mostly filtered out —
  //   one dice roll per Location, not per candidate, so a "yes" doesn't
  //   flood the pool with every service at once.
  // - Commerce locations generally don't have Needs at all — a shop's whole
  //   purpose is supplying, not lacking — so the target count can land on
  //   zero, unlike every other Purpose's 1-3 range.
  const needsAllowServices = resolvedPurposeId !== "commerce" && random() < 0.15;
  const needSourcePool = eligibleResources.length ? eligibleResources : allLocationResources;
  const needCandidatePool = needSourcePool.filter((resource) => needsAllowServices || resource.category !== "service");
  // Never the same Resource as an Asset — by exact id, or by sharing a
  // non-empty `family` (different sizes/variants of the same underlying
  // thing, e.g. every res.dragonshard-* — see resourceExclusionIds).
  const needExcludeIds = resourceExclusionIds(needCandidatePool, assetPicks);
  const needsTargetCount = resolvedPurposeId === "commerce" ? Math.floor(random() * 2) : 1 + Math.floor(random() * 3);
  const needPicks = pickDistinctResources(needCandidatePool, needsTargetCount, needExcludeIds, random);
  const needs = needPicks.map((entry) => ({ kind: "resource", refId: entry.id, label: entry.name || entry.id }));

  // Absolute last resort — every Location should have SOMETHING going on
  // with it (explicit user ask). The widened pools above already cover any
  // Type/Purpose/Environment combination a real content library would leave
  // uncovered, so this only ever fires when this System's location-category
  // Feature/Resource libraries are themselves essentially empty (a brand
  // new homebrew System with nothing authored yet). Prefers a Feature (the
  // richer of the two — a name plus a real mechanical/narrative hook) over
  // an Asset; if this System genuinely has neither, there's nothing left to
  // substitute and the Location stays empty, same as it always could.
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
    // Relationships (parentId/connectedTo, formerly) are never generated —
    // they're `relationship` records now (common/js/lib/relationship-graph.js),
    // added deliberately by the GM afterward, same as before.
    notes: "",
  };
}
