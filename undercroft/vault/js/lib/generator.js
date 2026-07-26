// The budget-driven effect generator. Unlike Crucible (recipe slots filled
// by traversal), Vault has no slots at all: a Signature Effect (a Feature)
// seeds the result, and the generator repeatedly pulls in whichever
// remaining eligible Feature has the strongest synergy with what's already
// selected, as long as it (and any of its own unmet `dependsOn`
// prerequisites, bundled atomically) fits inside the remaining budget.
// Budget itself comes entirely from the active System's generator-property
// fields (ordinary array fields on the System's `fields`, translated by
// tables.js's getSystemPropertyTypes) — this module has no hardcoded notion
// of "Rarity"/"Activation"/"Form" as concepts, only "one property type may
// set the ceiling, the rest spend from it," so a different System can define
// an entirely different set of property types with zero changes here.

const DEFAULT_TARGET_BUDGET = 10;

function pickRandom(list, random) {
  if (!list.length) return null;
  return list[Math.floor(random() * list.length)];
}

function matchesSystem(entity, systemId) {
  if (!systemId) return true;
  const ids = Array.isArray(entity.systemIds) ? entity.systemIds : [];
  return !ids.length || ids.includes(systemId);
}

// A feature with no categories tag is treated as universally compatible
// (the suite-wide "no tag means unconstrained" convention); otherwise it
// must claim "spell" or "item" — Vault produces one effect concept usable
// as either, per its design (Form controls presentation, not eligibility).
function matchesCategory(feature) {
  const categories = feature.tags?.categories;
  if (!Array.isArray(categories) || !categories.length) return true;
  return categories.includes("spell") || categories.includes("item");
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

// Bundles a candidate with every one of its own unmet `dependsOn`
// prerequisites (recursively, deduped), so a hard dependency is never added
// partially. Returns null if a dependency reference doesn't resolve to an
// eligible feature — the candidate is then skipped entirely rather than
// added without its prerequisite.
function collectDependencyBundle(feature, featuresById, selectedIds, seen) {
  if (seen.has(feature.id)) return [];
  seen.add(feature.id);
  const bundle = [feature];
  for (const depId of feature.dependsOn || []) {
    if (selectedIds.has(depId) || seen.has(depId)) continue;
    const dependency = featuresById.get(depId);
    if (!dependency) return null;
    const depBundle = collectDependencyBundle(dependency, featuresById, selectedIds, seen);
    if (!depBundle) return null;
    bundle.push(...depBundle);
  }
  return bundle;
}

/**
 * computeBudget(selectedFeatures, properties, propertyTypes)
 *
 * Shared by both the automatic generator and the manual authoring UI, so
 * they can never disagree about the running total. `properties` is a plain
 * `{ [propertyTypeId]: valueId }` map; `propertyTypes` is the active
 * System's `propertyTypes` array (or a subset/empty array — every step here
 * degrades gracefully to `DEFAULT_TARGET_BUDGET`/0-cost when data is missing).
 */
export function computeBudget(selectedFeatures, properties, propertyTypes) {
  let target = DEFAULT_TARGET_BUDGET;
  let spent = 0;
  (propertyTypes || []).forEach((propertyType) => {
    const valueId = properties?.[propertyType.id];
    const value = (propertyType.values || []).find((entry) => entry.id === valueId);
    if (!value) return;
    if (propertyType.setsBudgetCeiling) {
      target = Number(value.targetBudget ?? target);
    } else {
      spent += Number(value.cost ?? 0);
    }
  });
  (selectedFeatures || []).forEach((feature) => {
    spent += Number(feature.budgetCost ?? 0);
  });
  return { target, spent, remaining: target - spent };
}

function resolvePropertyValue(propertyType, overrideId, random) {
  const values = Array.isArray(propertyType.values) ? propertyType.values : [];
  if (!values.length) return null;
  if (overrideId) {
    const found = values.find((entry) => entry.id === overrideId);
    if (found) return found;
  }
  return pickRandom(values, random);
}

// Optional per-type override (blank = random), same convention as Crucible's
// Creature Type/Archetype/Role overrides.
function resolveProperties(propertyTypes, overrides, random) {
  const properties = {};
  (propertyTypes || []).forEach((propertyType) => {
    const value = resolvePropertyValue(propertyType, overrides?.[propertyType.id], random);
    if (value) properties[propertyType.id] = value.id;
  });
  return properties;
}

// Finds the single best-synergy, non-conflicting, affordable candidate (and
// its dependency bundle) among whatever isn't already selected — ties broken
// randomly, exactly like Crucible's resolveSlot. Returns null once nothing
// qualifies, which is the traversal's stopping condition.
function pickNextCandidate(eligibleFeatures, selected, properties, propertyTypes, random) {
  const featuresById = new Map(eligibleFeatures.map((entry) => [entry.id, entry]));
  const selectedIds = new Set(selected.map((entry) => entry.id));
  const { remaining } = computeBudget(selected, properties, propertyTypes);
  const scored = [];
  for (const candidate of eligibleFeatures) {
    if (selectedIds.has(candidate.id)) continue;
    if (conflictsWithSelected(candidate, selected)) continue;
    const score = synergyScore(candidate, selected);
    if (score <= 0) continue;
    const bundle = collectDependencyBundle(candidate, featuresById, selectedIds, new Set());
    if (!bundle) continue;
    if (bundle.some((entry) => entry.id !== candidate.id && conflictsWithSelected(entry, selected))) continue;
    const bundleCost = bundle.reduce((sum, entry) => sum + Number(entry.budgetCost ?? 0), 0);
    if (bundleCost > remaining) continue;
    scored.push({ candidate, bundle, score });
  }
  if (!scored.length) return null;
  const bestScore = Math.max(...scored.map((entry) => entry.score));
  const best = scored.filter((entry) => entry.score === bestScore);
  return pickRandom(best, random);
}

// Expands an already-selected list to include every transitively unmet
// dependsOn prerequisite, unconditionally — used for features that arrived
// via a locked pin or an explicit Signature Effect override, where the
// dependency must come along regardless of budget (same "explicit choice
// can exceed budget" allowance as everything else in this module). A
// missing dependency reference is skipped rather than failing generation.
function expandWithDependencies(selectedList, eligibleFeatures) {
  const featuresById = new Map(eligibleFeatures.map((entry) => [entry.id, entry]));
  const result = [...selectedList];
  const seen = new Set(result.map((entry) => entry.id));
  let index = 0;
  while (index < result.length) {
    const feature = result[index];
    index += 1;
    for (const depId of feature.dependsOn || []) {
      if (seen.has(depId)) continue;
      const dependency = featuresById.get(depId);
      if (!dependency) continue;
      seen.add(depId);
      result.push(dependency);
    }
  }
  return result;
}

function traverse(eligibleFeatures, selected, properties, propertyTypes, random) {
  let next = pickNextCandidate(eligibleFeatures, selected, properties, propertyTypes, random);
  while (next) {
    next.bundle.forEach((feature) => {
      if (!selected.some((entry) => entry.id === feature.id)) selected.push(feature);
    });
    next = pickNextCandidate(eligibleFeatures, selected, properties, propertyTypes, random);
  }
  return selected;
}

/**
 * generateEffect(allFeatures, propertyTypes, options)
 *
 * `propertyTypes` is the active System's `propertyTypes` array (already
 * fetched by the caller, same as Crucible receives its already-fetched
 * reference lists). Signature Effect is an optional override (blank =
 * random, like everything else in this suite); locked features and property
 * overrides let a caller pin part of the result before traversal fills in
 * the rest.
 */
export function generateEffect(allFeatures, propertyTypes, options = {}) {
  const {
    systemId = null,
    signatureFeatureId = "",
    lockedFeatureIds = [],
    propertyOverrides = {},
    random = Math.random,
  } = options;

  const eligibleFeatures = allFeatures.filter(
    (feature) => matchesSystem(feature, systemId) && matchesCategory(feature)
  );
  // propertyTypes belongs to one already-chosen System record (fetched by
  // the caller), not a merged cross-system list — no systemId filter needed.
  const eligiblePropertyTypes = propertyTypes || [];

  const properties = resolveProperties(eligiblePropertyTypes, propertyOverrides, random);

  const lockedFeatures = lockedFeatureIds
    .map((id) => eligibleFeatures.find((entry) => entry.id === id))
    .filter(Boolean);

  const featuresById = new Map(eligibleFeatures.map((entry) => [entry.id, entry]));
  let signatureFeature = signatureFeatureId
    ? eligibleFeatures.find((entry) => entry.id === signatureFeatureId)
    : null;
  if (!signatureFeature) {
    // A random Signature Effect must still respect the just-resolved
    // properties' budget — without this, an expensive random pick at a low
    // Rarity tier would start the whole generation over budget before
    // traversal even runs, breaking the "automatic path never exceeds
    // budget" guarantee. Its own dependsOn bundle counts too (bundled the
    // same way traversal candidates are), since a hard prerequisite pulled
    // in right after could otherwise immediately blow a budget the pick
    // alone just met. An explicit signatureFeatureId override is still
    // allowed to exceed it (that's a deliberate user choice, not a random
    // accident).
    const excludeIds = new Set(lockedFeatures.map((entry) => entry.id));
    const candidates = eligibleFeatures.filter((entry) => !excludeIds.has(entry.id));
    const { remaining } = computeBudget(lockedFeatures, properties, eligiblePropertyTypes);
    const withBundleCost = candidates
      .map((entry) => {
        const bundle = collectDependencyBundle(entry, featuresById, excludeIds, new Set());
        if (!bundle) return null;
        const cost = bundle.reduce((sum, feature) => sum + Number(feature.budgetCost ?? 0), 0);
        return { entry, cost };
      })
      .filter(Boolean);
    const affordable = withBundleCost.filter((item) => item.cost <= remaining);
    let chosen = null;
    if (affordable.length) {
      chosen = pickRandom(affordable, random);
    } else if (withBundleCost.length) {
      // Nothing fits at all (an unusually tight budget) — fall back to
      // whichever eligible feature (plus its own dependency bundle) costs
      // least, so the overshoot is as small as possible rather than an
      // arbitrary amount.
      const cheapest = Math.min(...withBundleCost.map((item) => item.cost));
      chosen = pickRandom(
        withBundleCost.filter((item) => item.cost === cheapest),
        random
      );
    }
    signatureFeature = chosen ? chosen.entry : null;
  }

  let selected = [...lockedFeatures];
  if (signatureFeature && !selected.some((entry) => entry.id === signatureFeature.id)) {
    selected.unshift(signatureFeature);
  }

  if (!selected.length) {
    throw new Error("Not enough Feature reference data to generate an effect.");
  }

  // Hard dependencies always come along, whether their requiring feature
  // arrived via a locked pin, an explicit Signature Effect override, or the
  // budget-aware random pick above (which already accounted for its own
  // bundle cost, so this is a no-op in that case).
  selected = expandWithDependencies(selected, eligibleFeatures);

  traverse(eligibleFeatures, selected, properties, eligiblePropertyTypes, random);

  return {
    systemIds: systemId ? [systemId] : [],
    signatureFeatureId: signatureFeature ? signatureFeature.id : null,
    featureIds: selected.map((entry) => entry.id),
    properties,
    budget: computeBudget(selected, properties, eligiblePropertyTypes),
    notes: "",
  };
}

