// Turns an imported monster's flat `stats.traits`/`actions`/`bonusActions`/
// `reactions`/`legendaryActions`/`lairActions` (the one canonical shape both
// the DDB and Fantasy Statblocks mappings already converge on — each entry
// `{name, description}`) into real `feature` Library references, so an
// imported monster ends up structurally identical to a Crucible-generated
// one: `isImportedStatBlock` (crucible/js/app.js) keys off `featureIds`
// being a real array, and once that's true every existing Crucible code
// path (Add Feature select, Features list, budget/cost display) just works
// with zero special-casing — this module's only job is producing that one
// array, not teaching Crucible anything new about how to render it.
//
// Two call sites share this exact function, both automatic-on-save — no
// manual/backfill button anywhere in this suite (deliberately cut): Loom's
// own saveEntity, and Crucible's own handleSave (crucible/js/app.js) calls
// it directly too, since Crucible's save path bypasses saveEntity entirely
// (it writes straight to dataManager.save). Either way, every monster save
// gets this unconditionally, not as an opt-in extra step — "every import
// should align with internal data standards" per explicit product
// direction, not a toggle. Idempotent by construction (hasConvertibleStatBlock
// below returns false once a monster has nothing left to convert), so it's
// safe to call on every save rather than gating on "is this the first
// save" — this is also what repairs a monster imported before this module
// existed, the next time it's opened and saved.

const ABILITY_GROUP_KEYS = ["traits", "actions", "bonusActions", "reactions", "legendaryActions", "lairActions"];

// Which `combat.actionCost` value a Feature created/matched from each
// ability group should carry — same vocabulary Crucible's own
// generator uses for `actions` (crucible/js/lib/stats.js), extended here to
// cover legendary/lair actions (a concept native generation has no
// equivalent for yet, so these two values are new). "traits" has no entry
// at all — a trait is passive, not action-economy-costed, same convention
// native generation's own traits-less output already implies.
const ACTION_COST_BY_GROUP_KEY = {
  actions: "action",
  bonusActions: "bonus-action",
  reactions: "reaction",
  legendaryActions: "legendary-action",
  lairActions: "lair-action",
};

// A trait/action name recurs across many creatures far more often than its
// exact mechanic does (5e's own templated writing conventions) — but not
// always (a monster's "Frenzied Rage" and another's happen to share a name
// while doing genuinely different things; conversely "Undead Nature" and
// the library's own "Unusual Nature" describe the identical mechanic under
// different names entirely). So matching leans on BOTH signals with
// different bars: a name match only needs modest description overlap to
// confirm it's really the same thing; without a name match, description
// similarity alone has to be strong enough to stand on its own.
const NAME_MATCH_SIMILARITY_THRESHOLD = 0.25;
const DESCRIPTION_ONLY_SIMILARITY_THRESHOLD = 0.6;

// Domain words common enough across nearly every monster trait/action
// (creature, damage, target, ...) that including them in the similarity
// score would wash out what actually distinguishes one mechanic from
// another — excluded the same way a search engine excludes stopwords.
const STOPWORDS = new Set([
  "a", "an", "the", "of", "to", "and", "or", "its", "it", "is", "are", "this", "that", "with", "on", "in", "at",
  "as", "by", "if", "for", "from", "when", "while", "can", "must", "not", "no", "one", "target", "targets",
  "creature", "creatures", "damage", "each", "another", "instead", "must", "make", "makes",
]);

function slugify(text) {
  return String(text || "")
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/(^-|-$)/g, "");
}

// Strips a trailing "(N/Day)"-style frequency count and trailing period(s)
// before comparing — the one systematic per-creature variation 5e's own
// templated trait names carry (e.g. "Legendary Resistance (3/Day).").
function normalizeName(name) {
  return String(name || "")
    .trim()
    .replace(/\s*\([^)]*\)\s*$/, "")
    .replace(/\.+$/, "")
    .toLowerCase()
    .trim();
}

// Only strips the trailing period(s) DDB/Fantasy-Statblocks source data
// tends to carry on a trait name — keeps the "(N/Day)" count, since a
// freshly-created one-off feature is scoped to just this one monster and
// that count is genuinely useful, faithful detail on a name that was never
// going to generalize anyway.
function displayName(name) {
  return String(name || "").trim().replace(/\.+$/, "");
}

function significantTokens(text) {
  const words = String(text || "")
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, " ")
    .split(/\s+/)
    .filter((word) => word.length > 2 && !STOPWORDS.has(word));
  return new Set(words);
}

function jaccardSimilarity(textA, textB) {
  const a = significantTokens(textA);
  const b = significantTokens(textB);
  if (!a.size || !b.size) return 0;
  let intersection = 0;
  a.forEach((word) => {
    if (b.has(word)) intersection += 1;
  });
  const union = a.size + b.size - intersection;
  return union ? intersection / union : 0;
}

// Best-scoring qualifying candidate, or null (meaning: create a new one-off
// feature for this trait instead).
function findMatch(trait, candidates) {
  const traitName = normalizeName(trait.name);
  const traitDescription = trait.description || "";
  let best = null;
  let bestScore = 0;
  candidates.forEach((feature) => {
    const similarity = jaccardSimilarity(traitDescription, feature.description || feature.mechanics?.text || "");
    const nameMatches = traitName && traitName === normalizeName(feature.name);
    const qualifies = nameMatches
      ? similarity >= NAME_MATCH_SIMILARITY_THRESHOLD
      : similarity >= DESCRIPTION_ONLY_SIMILARITY_THRESHOLD;
    if (qualifies && similarity > bestScore) {
      best = feature;
      bestScore = similarity;
    }
  });
  return best;
}

// `existingFeatures` — every `feature` Library entry already loaded by the
// caller (Loom's own reference fetch, or Crucible's own module-level
// `features` list) — filtered here to the active System + monster category,
// not the caller's job. `monsterSlug` seeds new one-off features' ids
// (`feat.<monsterSlug>-<trait-slug>`) so two different monsters' same-named-
// but-different traits never collide.
//
// Mutates and returns `record` (sets `featureIds`, deletes the now-
// superseded ability-group arrays from `record.stats`) — the caller still
// owns saving it. Newly-created features are saved here directly via
// `dataManager.save("feature", ...)` as they're created (not batched at the
// end), and immediately added to the working candidate pool so a later
// trait — on this same monster, or a later monster in the same import
// batch — that shares the exact mechanic reuses it instead of creating a
// duplicate.
export async function convertStatBlockToFeatures(record, { dataManager, existingFeatures, monsterSlug }) {
  const stats = record?.stats;
  const result = { featureIds: [], matchedCount: 0, createdCount: 0 };
  if (!stats || !dataManager) return result;

  const systemId = Array.isArray(record.systemIds) ? record.systemIds[0] : record.systemIds || null;
  const candidatePool = (existingFeatures || []).filter((feature) => {
    const categories = feature.tags?.categories;
    const matchesCategory = !Array.isArray(categories) || !categories.length || categories.includes("monster");
    const ids = Array.isArray(feature.systemIds) ? feature.systemIds : [];
    const matchesSystem = !systemId || !ids.length || ids.includes(systemId);
    return matchesCategory && matchesSystem;
  });

  const featureIds = [];
  for (const groupKey of ABILITY_GROUP_KEYS) {
    const entries = Array.isArray(stats[groupKey]) ? stats[groupKey] : [];
    const actionCost = ACTION_COST_BY_GROUP_KEY[groupKey];
    for (const trait of entries) {
      if (!trait?.name) continue;
      const match = findMatch(trait, candidatePool);
      if (match) {
        featureIds.push(match.id);
        result.matchedCount += 1;
        // Backfill actionCost only if the matched Feature doesn't already
        // have one — never silently overwrite already-authored content
        // just because this particular import happened to categorize the
        // same mechanic differently.
        if (actionCost && !match.combat?.actionCost) {
          match.combat = { ...(match.combat || {}), actionCost };
          await dataManager.save("feature", match.id, match);
        }
        continue;
      }
      const newFeature = {
        id: `feat.${monsterSlug}-${slugify(trait.name)}`,
        name: displayName(trait.name),
        systemIds: systemId ? [systemId] : [],
        description: trait.description || "",
        mechanics: { type: "passive", text: trait.description || "" },
        // 0, not omitted — this is genuinely unbalanced/unreviewed content
        // (see the module comment), and an explicit 0 reads as "not yet
        // costed" rather than silently behaving like a free pick forever.
        budgetCost: 0,
        tags: { behaviors: [], recipeSlots: [], roles: [], creatureTypes: [], categories: ["monster"] },
        synergizesWith: [],
        conflictsWith: [],
        ...(actionCost ? { combat: { actionCost } } : {}),
      };
      await dataManager.save("feature", newFeature.id, newFeature);
      candidatePool.push(newFeature);
      featureIds.push(newFeature.id);
      result.createdCount += 1;
    }
    delete stats[groupKey];
  }

  // Saving Throws/Skills come off an import as `[{name, value}]`; Spells is
  // an intro sentence plus per-frequency spell-list objects. Nothing in
  // Crucible reads either shape programmatically (deriveStats' own native
  // output has no equivalent field at all), and Crucible's Stats section
  // (renderStats) renders every stat as a plain editable text box — so both
  // get flattened to one plain string here, the same "fully editable, no
  // bespoke structure" treatment every other imported stat already gets.
  // Idempotent: a value that's already a string (already converted, or a
  // hand-authored record) is left alone.
  if (Array.isArray(stats.savingThrows)) stats.savingThrows = formatValueList(stats.savingThrows);
  if (Array.isArray(stats.skills)) stats.skills = formatValueList(stats.skills);
  if (stats.spells !== undefined) stats.spells = formatSpells(stats.spells);

  record.featureIds = featureIds;
  result.featureIds = featureIds;
  return result;
}

function formatValueList(entries) {
  if (!Array.isArray(entries) || !entries.length) return "";
  return entries
    .map((entry) => {
      if (!entry || typeof entry !== "object") return String(entry);
      const numericValue = Number(entry.value);
      const sign = Number.isFinite(numericValue) && numericValue >= 0 ? "+" : "";
      const displayValue = Number.isFinite(numericValue) ? numericValue : (entry.value ?? "");
      return `${entry.name || ""} ${sign}${displayValue}`.trim();
    })
    .filter(Boolean)
    .join(", ");
}

function formatSpells(spells) {
  if (typeof spells === "string") return spells;
  if (!Array.isArray(spells) || !spells.length) return "";
  return spells
    .map((entry) => {
      if (typeof entry === "string") return entry;
      if (entry && typeof entry === "object") {
        return Object.entries(entry)
          .map(([frequency, list]) => `${frequency}: ${list}`)
          .join("; ");
      }
      return "";
    })
    .filter(Boolean)
    .join(" ");
}

// Loom's own saveEntity checks this before running the conversion above at
// all — a monster whose importer already produced no traits/actions (or a
// hand-authored one with a genuinely empty stat block) has nothing to
// convert, so there's no point fetching the feature library or touching the
// record for it.
export function hasConvertibleStatBlock(record) {
  const stats = record?.stats;
  if (!stats) return false;
  return ABILITY_GROUP_KEYS.some((key) => Array.isArray(stats[key]) && stats[key].length > 0);
}
