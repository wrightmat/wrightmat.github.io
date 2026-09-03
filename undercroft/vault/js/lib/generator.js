// The budget-driven wonder generator. Unlike Crucible (recipe slots filled
// by traversal), Vault has no slots at all: a Signature Feature (the anchor)
// seeds the result, and the generator repeatedly pulls in whichever
// remaining eligible Feature has the strongest synergy with what's already
// selected, as long as it (and any unmet `dependsOn` prerequisites, bundled
// atomically) fits inside the remaining budget. Budget comes entirely from
// the active System's generator-property fields (translated by tables.js's
// getSystemPropertyTypes) — this module has no hardcoded notion of "Rarity"/
// "Activation"/"Form", only "one property type may set the ceiling, the rest
// spend from it," so a different System can define an entirely different
// set of property types with zero changes here.

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

// A feature with no categories tag is universally compatible; otherwise it
// must claim "spell" or "item" — Vault produces one wonder concept usable as
// either (Form controls presentation, not eligibility).
export function matchesCategory(feature) {
  const categories = feature.tags?.categories;
  if (!Array.isArray(categories) || !categories.length) return true;
  return categories.includes("spell") || categories.includes("item");
}

// A Feature with no `tags.propertyHints`, or a class with no
// `allowedFeatureTags` (a non-caster, or a System with no "classes" field),
// is unconstrained. Only an actual populated, non-overlapping pair excludes
// a Feature — e.g. a Wizard tagged "illusion"/"ritual" can take a Feature
// tagged `["illusion","advanced"]` but not `["healing","revival","divine"]`.
function matchesClass(feature, allowedFeatureTags) {
  if (!Array.isArray(allowedFeatureTags) || !allowedFeatureTags.length) return true;
  const hints = feature.tags?.propertyHints;
  if (!Array.isArray(hints) || !hints.length) return true;
  return hints.some((tag) => allowedFeatureTags.includes(tag));
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

// Bundles a candidate with every unmet `dependsOn` prerequisite
// (recursively, deduped), so a hard dependency is never added partially.
// Returns null if a dependency doesn't resolve — the candidate is then
// skipped entirely rather than added without its prerequisite.
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

// A Feature can optionally carry a `tiers` array (e.g. Healing scaling from
// a Common "2d4+2" to a Very-Rare "10d4+20", each its own
// `{id, name, shortName, budgetCost}`) — the same graduated-level shape
// Combat Scaling/Rarity use elsewhere, applied per-Feature instead of
// System-wide. `featureTierIds` is a `{ [featureId]: tierId }` map; a
// missing entry uses the feature's own base `budgetCost` (its cheapest tier).
export function resolveFeatureBudgetCost(feature, featureTierIds) {
  const tierId = featureTierIds?.[feature?.id];
  if (tierId && Array.isArray(feature?.tiers)) {
    const tier = feature.tiers.find((entry) => entry.id === tierId);
    if (tier && typeof tier.budgetCost === "number") return tier.budgetCost;
  }
  return Number(feature?.budgetCost ?? 0);
}

/**
 * computeBudget(selectedFeatures, properties, propertyTypes, featureTierIds)
 *
 * Shared by both the automatic generator and the manual authoring UI, so
 * they can never disagree about the running total. `properties` is a plain
 * `{ [propertyTypeId]: valueId }` map; `propertyTypes` is the active
 * System's `propertyTypes` array (degrades gracefully to
 * DEFAULT_TARGET_BUDGET/0-cost when data is missing).
 */
export function computeBudget(selectedFeatures, properties, propertyTypes, featureTierIds = {}) {
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
    spent += resolveFeatureBudgetCost(feature, featureTierIds);
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

// Backs the per-property reroll button in Identity (mirroring Forge's/
// Crucible's own per-attribute reroll) — excludes the current value when
// another choice exists. Returns null if nothing else to reroll into.
export function rerollPropertyValue(propertyType, currentValueId, { random = Math.random } = {}) {
  const values = Array.isArray(propertyType?.values) ? propertyType.values : [];
  const eligible = values.filter((value) => value.id !== currentValueId);
  return pickRandom(eligible.length ? eligible : values, random);
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
// randomly, exactly like Crucible's resolveSlot. Prefers positive synergy,
// but falls back to any compatible, affordable candidate once nothing
// synergizes — without this, traversal routinely stalled after 1-2 Features
// with most of the budget still unspent. Returns null once nothing
// qualifies (out of budget, or every candidate used/conflicting).
function pickNextCandidate(eligibleFeatures, selected, properties, propertyTypes, random) {
  const featuresById = new Map(eligibleFeatures.map((entry) => [entry.id, entry]));
  const selectedIds = new Set(selected.map((entry) => entry.id));
  const { remaining } = computeBudget(selected, properties, propertyTypes);
  const scored = [];
  for (const candidate of eligibleFeatures) {
    if (selectedIds.has(candidate.id)) continue;
    if (conflictsWithSelected(candidate, selected)) continue;
    const bundle = collectDependencyBundle(candidate, featuresById, selectedIds, new Set());
    if (!bundle) continue;
    if (bundle.some((entry) => entry.id !== candidate.id && conflictsWithSelected(entry, selected))) continue;
    const bundleCost = bundle.reduce((sum, entry) => sum + Number(entry.budgetCost ?? 0), 0);
    if (bundleCost > remaining) continue;
    scored.push({ candidate, bundle, score: synergyScore(candidate, selected) });
  }
  if (!scored.length) return null;
  const bestScore = Math.max(...scored.map((entry) => entry.score));
  const best = scored.filter((entry) => entry.score === bestScore);
  return pickRandom(best, random);
}

// Expands an already-selected list to include every transitively unmet
// dependsOn prerequisite, unconditionally — used for features that arrived
// via a locked pin or explicit Signature Feature override, where the
// dependency comes along regardless of budget. A missing dependency is skipped.
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

// Proactive readiness check for the Generate button — mirrors generateWonder's
// own eligibleFeatures filter exactly, so the button's disabled state and
// generateWonder's actual throw condition can never drift apart. Doesn't
// account for an impossibly tight budget leaving nothing affordable — that
// stays a rare, reactive edge case the click handler's own guard catches.
export function getWonderGenerationBlockReason(allFeatures, options = {}) {
  const { systemId = null, allowedFeatureTags = null } = options;
  const eligibleFeatures = allFeatures.filter(
    (feature) => matchesSystem(feature, systemId) && matchesCategory(feature) && matchesClass(feature, allowedFeatureTags)
  );
  if (eligibleFeatures.length) return null;
  return "Not enough Feature reference data to generate a wonder.";
}

/**
 * generateWonder(allFeatures, propertyTypes, options)
 *
 * `propertyTypes` is the active System's `propertyTypes` array (already
 * fetched by the caller). Signature Feature is an optional override (blank =
 * random); locked features and property overrides let a caller pin part of
 * the result before traversal fills in the rest.
 */
export function generateWonder(allFeatures, propertyTypes, options = {}) {
  const {
    systemId = null,
    signatureFeatureId = "",
    lockedFeatureIds = [],
    propertyOverrides = {},
    // The active System's class vocabulary is read entirely by the caller
    // (vault/js/app.js, via getSystemClasses) and passed as this class's own
    // allowedFeatureTags — no hardcoded "Wizard"/"Cleric" notion here, same
    // as Vault has none of "Rarity". null/undefined means unconstrained.
    allowedFeatureTags = null,
    random = Math.random,
  } = options;

  const eligibleFeatures = allFeatures.filter(
    (feature) => matchesSystem(feature, systemId) && matchesCategory(feature) && matchesClass(feature, allowedFeatureTags)
  );
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
    // A random Signature Feature must respect the just-resolved properties'
    // budget (its own dependsOn bundle counts too), or an expensive pick at
    // a low Rarity tier would start generation already over budget. An
    // explicit signatureFeatureId override is still allowed to exceed it —
    // that's a deliberate user choice, not a random accident.
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
      // Nothing fits (an unusually tight budget) — fall back to whichever
      // eligible feature costs least, so the overshoot is as small as possible.
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
    throw new Error("Not enough Feature reference data to generate a wonder.");
  }

  // Hard dependencies always come along, regardless of how their requiring
  // feature arrived (locked pin, Signature override, or the budget-aware
  // pick above, which already accounted for its own bundle cost).
  selected = expandWithDependencies(selected, eligibleFeatures);

  traverse(eligibleFeatures, selected, properties, eligiblePropertyTypes, random);

  return {
    systemIds: systemId ? [systemId] : [],
    signatureFeatureId: signatureFeature ? signatureFeature.id : null,
    featureIds: selected.map((entry) => entry.id),
    // Always present (even empty) so callers never need an `|| {}` guard —
    // automatic generation always starts a tiered feature at its cheapest
    // tier; a GM upgrades it by hand afterward.
    featureTiers: {},
    properties,
    budget: computeBudget(selected, properties, eligiblePropertyTypes),
    notes: "",
  };
}
