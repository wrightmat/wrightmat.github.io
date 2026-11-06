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
// Real items rarely carry a drawback, so a generated one gets at most one, and only sometimes.
const MAX_REFUNDS = 1;
const REFUND_CHANCE = 0.25;
// The budget is a ceiling: a generated wonder spends somewhere between this share of it and all of it.
const MIN_SPEND_SHARE = 0.5;

// A base item lends its stats (damage, armor values, weight, ...), never its identity or Library bookkeeping.
const BASE_ITEM_SKIP_KEYS = new Set([
  "id", "index", "name", "notes", "url", "mapping", "price", "systemIds", "properties", "featureIds", "featureParams",
  "featureTiers", "features", "signatureFeatureId", "budget", "baseItemId", "charges", "createdAt", "updatedAt", "relationships",
]);

function pickRandom(list, random) {
  if (!list.length) return null;
  return list[Math.floor(random() * list.length)];
}

// Each use of a feature by a Library item of the same Form adds this much weight to an unseen feature's 1, so a
// ring draws mostly what real rings do while still sometimes trying something new.
const LIBRARY_USE_WEIGHT = 3;

function pickWeighted(list, weightOf, random) {
  if (!list.length) return null;
  const weights = list.map(weightOf);
  let roll = random() * weights.reduce((sum, weight) => sum + weight, 0);
  for (let index = 0; index < list.length; index += 1) {
    roll -= weights[index];
    if (roll < 0) return list[index];
  }
  return list[list.length - 1];
}

// How many Library items sharing the wonder's Form (any property whose values pick a feature category) use each feature.
function libraryFeatureUses(libraryItems, properties, propertyTypes) {
  const formIds = propertyTypes
    .filter((propertyType) => (propertyType.values || []).some((value) => value.featureCategory))
    .map((propertyType) => propertyType.id);
  const uses = new Map();
  for (const item of libraryItems) {
    if (!formIds.every((id) => item.properties?.[id] === properties[id])) continue;
    for (const id of item.featureIds || []) uses.set(id, (uses.get(id) || 0) + 1);
  }
  return (feature) => 1 + LIBRARY_USE_WEIGHT * (uses.get(feature.id) || 0);
}

function matchesSystem(entity, systemId) {
  if (!systemId) return true;
  const ids = Array.isArray(entity.systemIds) ? entity.systemIds : [];
  return !ids.length || ids.includes(systemId);
}

// A feature with no categories tag is universally compatible; otherwise it must claim one of `required` (the
// resolved Form's `featureCategory`), or "spell" or "item" when no Form says which.
export function matchesCategory(feature, required) {
  const categories = feature.tags?.categories;
  if (!Array.isArray(categories) || !categories.length) return true;
  const allowed = Array.isArray(required) && required.length ? required : ["spell", "item"];
  return categories.some((category) => allowed.includes(category));
}

// A feature may name the property values it needs ({ form: ["weapon"], tier: ["tier-3", "tier-4"] }), checked
// against the wonder's own properties and whatever its base item lends (a weapon's Primary/Secondary type).
function matchesRequiredProperties(feature, properties) {
  const required = feature.requiresProperties;
  if (!required || typeof required !== "object") return true;
  return Object.entries(required).every(
    ([key, values]) => !Array.isArray(values) || !values.length || values.map(String).includes(String(properties?.[key] ?? ""))
  );
}

function isRefund(feature) {
  return Number(feature?.budgetCost ?? 0) < 0;
}

// A feature's priced tiers, cheapest first (a tier without a number, or a negative one, isn't an upgrade step).
function pricedTiers(feature) {
  return (Array.isArray(feature?.tiers) ? feature.tiers : [])
    .filter((tier) => typeof tier?.budgetCost === "number" && tier.budgetCost >= 0)
    .sort((a, b) => a.budgetCost - b.budgetCost);
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
 * computeBudget(selectedFeatures, properties, propertyTypes, featureTierIds, baseItem)
 *
 * Shared by both the automatic generator and the manual authoring UI, so
 * they can never disagree about the running total. `properties` is a plain
 * `{ [propertyTypeId]: valueId }` map; `propertyTypes` is the active
 * System's `propertyTypes` array (degrades gracefully to
 * DEFAULT_TARGET_BUDGET/0-cost when data is missing).
 */
export function computeBudget(selectedFeatures, properties, propertyTypes, featureTierIds = {}, baseItem = null) {
  let target = DEFAULT_TARGET_BUDGET;
  let spent = 0;
  (propertyTypes || []).forEach((propertyType) => {
    const valueId = properties?.[propertyType.id];
    const value = (propertyType.values || []).find((entry) => entry.id === valueId);
    if (propertyType.setsBudgetCeiling) {
      // A base item with its own ceiling value (a Tier 3 sword) already has what that value adds over the lowest
      // one in its stats, so only the lowest value's budget is left for features.
      const baseValue = (propertyType.values || []).find((entry) => entry.id === baseItem?.properties?.[propertyType.id]);
      if (baseValue) {
        spent += Number(baseValue.cost ?? 0) - Math.min(...propertyType.values.map((entry) => Number(entry.cost ?? 0)));
      }
    }
    if (!value) return;
    if (propertyType.setsBudgetCeiling) {
      target = Number(value.cost ?? target);
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

// The resolved property value (a Weapon Form, say) whose wonders are built on a plain System item, if any.
function baseItemProperty(properties, propertyTypes) {
  for (const propertyType of propertyTypes || []) {
    const value = (propertyType.values || []).find((entry) => entry.id === properties?.[propertyType.id]);
    if (value?.baseItem) return { propertyTypeId: propertyType.id, valueId: value.id };
  }
  return null;
}

function baseStatKeys(record) {
  return Object.keys(record || {}).filter((key) => !BASE_ITEM_SKIP_KEYS.has(key));
}

// Plain Library items sharing that value: no features, and no ceiling value (a Rarity, a Tier) other than the
// wonder's own. One per name, the one with most stats kept.
export function baseItemCandidates(wonders, properties, propertyTypes) {
  const wanted = baseItemProperty(properties, propertyTypes);
  if (!wanted) return [];
  const ceilingIds = (propertyTypes || []).filter((propertyType) => propertyType.setsBudgetCeiling).map((propertyType) => propertyType.id);
  const byName = new Map();
  (wonders || []).forEach((wonder) => {
    if (wonder.properties?.[wanted.propertyTypeId] !== wanted.valueId) return;
    if (Array.isArray(wonder.featureIds) && wonder.featureIds.length) return;
    if (ceilingIds.some((id) => wonder.properties?.[id] && wonder.properties[id] !== properties?.[id])) return;
    const key = String(wonder.name || wonder.id).toLowerCase();
    const existing = byName.get(key);
    if (!existing || baseStatKeys(wonder).length > baseStatKeys(existing).length) byName.set(key, wonder);
  });
  return [...byName.values()].sort((a, b) => String(a.name || a.id).localeCompare(String(b.name || b.id)));
}

// Swaps `record` onto `base` (or off any base when null), taking away whatever the previous base lent it.
export function applyBaseItem(record, base, previousBase, propertyTypes) {
  const ownPropertyKeys = new Set((propertyTypes || []).map((propertyType) => propertyType.id));
  const properties = { ...(record.properties || {}) };
  if (previousBase) {
    baseStatKeys(previousBase).forEach((key) => delete record[key]);
    Object.keys(previousBase.properties || {}).forEach((key) => {
      if (!ownPropertyKeys.has(key)) delete properties[key];
    });
  }
  if (base) {
    baseStatKeys(base).forEach((key) => {
      record[key] = structuredClone(base[key]);
    });
    Object.entries(base.properties || {}).forEach(([key, value]) => {
      if (!ownPropertyKeys.has(key)) properties[key] = value;
    });
    record.baseItemId = base.id;
  } else {
    delete record.baseItemId;
  }
  record.properties = properties;
  return record;
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
// Creature Type/Archetype/Role overrides. The ceiling is resolved first, and a
// random value must fit what's left of it with a point to spare for the
// Signature (the cheapest value when none does); an override is never limited.
function resolveProperties(propertyTypes, overrides, random) {
  const properties = {};
  const ordered = [...(propertyTypes || [])].sort((a, b) => Number(Boolean(b.setsBudgetCeiling)) - Number(Boolean(a.setsBudgetCeiling)));
  ordered.forEach((propertyType) => {
    const values = Array.isArray(propertyType.values) ? propertyType.values : [];
    const overridden = overrides?.[propertyType.id] && values.some((entry) => entry.id === overrides[propertyType.id]);
    let value;
    if (propertyType.setsBudgetCeiling || overridden) {
      value = resolvePropertyValue(propertyType, overrides?.[propertyType.id], random);
    } else {
      const allowance = computeBudget([], properties, propertyTypes).remaining - 1;
      const fitting = values.filter((entry) => Number(entry.cost ?? 0) <= allowance);
      const cheapest = Math.min(...values.map((entry) => Number(entry.cost ?? 0)));
      value = pickRandom(fitting.length ? fitting : values.filter((entry) => Number(entry.cost ?? 0) === cheapest), random);
    }
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
function pickNextCandidate(eligibleFeatures, selected, properties, propertyTypes, random, featureTiers, refundsLeft, baseItem, weightOf) {
  const featuresById = new Map(eligibleFeatures.map((entry) => [entry.id, entry]));
  const selectedIds = new Set(selected.map((entry) => entry.id));
  const { remaining } = computeBudget(selected, properties, propertyTypes, featureTiers, baseItem);
  const scored = [];
  for (const candidate of eligibleFeatures) {
    if (selectedIds.has(candidate.id)) continue;
    if (isRefund(candidate) && refundsLeft <= 0) continue;
    if (conflictsWithSelected(candidate, selected)) continue;
    const bundle = collectDependencyBundle(candidate, featuresById, selectedIds, new Set());
    if (!bundle) continue;
    if (bundle.some((entry) => entry.id !== candidate.id && conflictsWithSelected(entry, selected))) continue;
    if (bundle.filter(isRefund).length > refundsLeft) continue;
    const bundleCost = bundle.reduce((sum, entry) => sum + Number(entry.budgetCost ?? 0), 0);
    if (bundleCost > remaining) continue;
    scored.push({ candidate, bundle, score: synergyScore(candidate, selected) });
  }
  if (!scored.length) return null;
  const bestScore = Math.max(...scored.map((entry) => entry.score));
  const best = scored.filter((entry) => entry.score === bestScore);
  return pickWeighted(best, (entry) => weightOf(entry.candidate), random);
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

// Raises one chosen tiered feature a step (the Signature first), within what's left of the ceiling. Returns
// whether anything changed.
function upgradeOneTier(selected, featureTiers, remaining) {
  for (const feature of selected) {
    const tiers = pricedTiers(feature);
    if (!tiers.length) continue;
    const current = resolveFeatureBudgetCost(feature, featureTiers);
    const next = tiers.find((tier) => tier.budgetCost > current);
    if (next && next.budgetCost - current <= remaining) {
      featureTiers[feature.id] = next.id;
      return true;
    }
  }
  return false;
}

// Until the drawn spend is reached: strengthen what's chosen before adding anything new, so the budget goes into
// one strong effect rather than many weak ones.
function traverse(eligibleFeatures, selected, properties, propertyTypes, random, featureTiers, spendTarget, refundsAllowed, baseItem, weightOf) {
  const budget = () => computeBudget(selected, properties, propertyTypes, featureTiers, baseItem);
  while (budget().spent < spendTarget) {
    if (upgradeOneTier(selected, featureTiers, budget().remaining)) continue;
    const refundsLeft = refundsAllowed - selected.filter(isRefund).length;
    const next = pickNextCandidate(eligibleFeatures, selected, properties, propertyTypes, random, featureTiers, refundsLeft, baseItem, weightOf);
    if (!next) break;
    next.bundle.forEach((feature) => {
      if (!selected.some((entry) => entry.id === feature.id)) selected.push(feature);
    });
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
    // The System's Library items: what a Form's base item is drawn from, and how often each feature is favored.
    libraryItems = [],
    // Pins the base item (blank = random).
    baseItemId = "",
    random = Math.random,
  } = options;

  const eligiblePropertyTypes = propertyTypes || [];
  const properties = resolveProperties(eligiblePropertyTypes, propertyOverrides, random);
  // A Spell-form wonder draws spell features and any other Form item features, as the System's Form values say.
  const requiredCategories = eligiblePropertyTypes
    .map((propertyType) => (propertyType.values || []).find((value) => value.id === properties[propertyType.id])?.featureCategory)
    .filter(Boolean);
  const bases = baseItemCandidates(libraryItems, properties, eligiblePropertyTypes);
  const weightOf = libraryFeatureUses(libraryItems, properties, eligiblePropertyTypes);
  const baseItem = bases.find((entry) => entry.id === baseItemId) || pickRandom(bases, random);
  const effectiveProperties = { ...(baseItem?.properties || {}), ...properties };
  const eligibleFeatures = allFeatures.filter(
    (feature) =>
      matchesSystem(feature, systemId) &&
      matchesCategory(feature, requiredCategories) &&
      matchesClass(feature, allowedFeatureTags) &&
      matchesRequiredProperties(feature, effectiveProperties)
  );
  const featureTiers = {};

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
    // The Signature is the item's core effect, so never a drawback or a free add-on (Charges, Attunement).
    const excludeIds = new Set(lockedFeatures.map((entry) => entry.id));
    const candidates = eligibleFeatures.filter(
      (entry) => !excludeIds.has(entry.id) && (Number(entry.budgetCost ?? 0) > 0 || pricedTiers(entry).some((tier) => tier.budgetCost > 0))
    );
    const { remaining } = computeBudget(lockedFeatures, properties, eligiblePropertyTypes, {}, baseItem);
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
      chosen = pickWeighted(affordable, (item) => weightOf(item.entry), random);
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

  const { target } = computeBudget([], properties, eligiblePropertyTypes);
  const spendTarget = Math.round(target * (MIN_SPEND_SHARE + random() * (1 - MIN_SPEND_SHARE)));
  const refundsAllowed = random() < REFUND_CHANCE ? MAX_REFUNDS : 0;
  traverse(eligibleFeatures, selected, properties, eligiblePropertyTypes, random, featureTiers, spendTarget, refundsAllowed, baseItem, weightOf);

  const wonder = {
    systemIds: systemId ? [systemId] : [],
    signatureFeatureId: signatureFeature ? signatureFeature.id : null,
    featureIds: selected.map((entry) => entry.id),
    // Always present (even empty) so callers never need an `|| {}` guard. A tiered feature with no entry is at
    // its cheapest tier.
    featureTiers,
    properties,
    budget: computeBudget(selected, properties, eligiblePropertyTypes, featureTiers, baseItem),
    notes: "",
  };
  return baseItem ? applyBaseItem(wonder, baseItem, null, eligiblePropertyTypes) : wonder;
}
