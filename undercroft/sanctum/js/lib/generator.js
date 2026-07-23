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

// A feature with no categories tag is treated as universally compatible (the
// suite-wide "no tag means unconstrained" convention); otherwise it must claim
// "location".
function matchesCategory(feature) {
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

// Only ever pulls in a candidate with positive synergy to what's already selected —
// same "never auto-add a zero-synergy feature" rule Vault uses, since there's no
// slot forcing a fill here either. Returns null once nothing qualifies.
function pickNextFeature(eligibleFeatures, selected, random) {
  const selectedIds = new Set(selected.map((entry) => entry.id));
  const scored = [];
  for (const candidate of eligibleFeatures) {
    if (selectedIds.has(candidate.id)) continue;
    if (conflictsWithSelected(candidate, selected)) continue;
    const score = synergyScore(candidate, selected);
    if (score <= 0) continue;
    scored.push({ entry: candidate, score });
  }
  if (!scored.length) return null;
  const bestScore = Math.max(...scored.map((entry) => entry.score));
  const best = scored.filter((entry) => entry.score === bestScore);
  return pickRandom(best, random).entry;
}

function selectFeatures(eligibleFeatures, lockedFeatures, random) {
  const selected = [...lockedFeatures];
  if (!selected.length) {
    const seed = pickRandom(eligibleFeatures, random);
    if (seed) selected.push(seed);
  }
  if (!selected.length) return selected;
  const targetCount = 2 + Math.floor(random() * 3); // 2, 3, or 4
  while (selected.length < targetCount) {
    const next = pickNextFeature(eligibleFeatures, selected, random);
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
  const eligibleResources = resources.filter(
    (resource) =>
      matchesSystem(resource, systemId) && matchesLocationTags(resource, resolvedTypeId, resolvedPurposeId, resolvedEnvironment)
  );

  const lockedFeatures = lockedFeatureIds.map((id) => eligibleFeatures.find((entry) => entry.id === id)).filter(Boolean);
  const selectedFeatures = selectFeatures(eligibleFeatures, lockedFeatures, random);

  const assetCandidates = eligibleResources.filter((resource) => !conflictsWithFeatures(resource, selectedFeatures));
  const assetPicks = pickDistinctResources(assetCandidates, 1 + Math.floor(random() * 3), new Set(), random);
  const assets = assetPicks.map((entry) => ({ kind: "resource", refId: entry.id, label: entry.name || entry.id }));
  // Needs are deliberately drawn from the FULL eligible pool (not
  // assetCandidates) — a resource that conflicts with a selected Feature as
  // an Asset is exactly the kind of thing that's plausible as a Need instead.
  const needPicks = pickDistinctResources(
    eligibleResources,
    1 + Math.floor(random() * 3),
    new Set(assetPicks.map((entry) => entry.id)),
    random
  );
  const needs = needPicks.map((entry) => ({ kind: "resource", refId: entry.id, label: entry.name || entry.id }));

  return {
    systemIds: systemId ? [systemId] : [],
    settingId,
    typeId: resolvedTypeId || null,
    purposeId: resolvedPurposeId || null,
    environment: resolvedEnvironment || null,
    featureIds: selectedFeatures.map((entry) => entry.id),
    assets,
    needs,
    parentId: null,
    connectedTo: [],
    notes: "",
  };
}
