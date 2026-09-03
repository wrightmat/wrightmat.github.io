// Shared "read a System's own Combat Scaling data" helper — originally
// Crucible-only, moved here once the Dashboard's Encounter Difficulty & XP
// calculator needed the exact same lookup. Crucible's tables.js now
// imports and re-exports this instead of defining it locally.

export function slugify(name) {
  return String(name || "")
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/(^-|-$)/g, "");
}

// Best-effort guess for which array field IS a System's Combat Scaling data
// — a pre-fill only, never the sole source of truth. Unlike
// guessAbilityFieldKey (generator-kit.js), there's no reliable SHAPE
// signature here (D&D's CR carries armorClass/hitPoints/attackBonus/saveDC,
// Daggerheart's Tier carries none of that), so this is name-preference only.
// The three names below are every real one found across this suite's
// Systems: "combatScaling" (majority, the hardcoded final fallback),
// "challengeRating" (D&D 3.5e/5e, Pathfinder 1E, Starfinder 1E, d20 Modern),
// "tier" (Daggerheart).
const COMBAT_SCALING_FIELD_NAME_PREFERENCE = ["combatScaling", "challengeRating", "tier"];

export function guessCombatScalingFieldKey(fields) {
  const arrayFieldKeys = new Set((Array.isArray(fields) ? fields : []).filter((f) => f?.type === "array").map((f) => f.key));
  return COMBAT_SCALING_FIELD_NAME_PREFERENCE.find((name) => arrayFieldKeys.has(name)) || "";
}

// combatScaling is an ordinary array field on the active System's `fields`
// — same mechanism as Vault's generator-property fields, but unlike those,
// each value is a full scaling level (CR, Tier, ...) with concrete target
// stats, returned close to as-authored (just adding a slugified `id`) so
// `hitPoints`/`armorClass`/`xp`/etc. survive. Not auto-seeded on new
// Systems — absent means no scaling data, "derive nothing" not an error.
//
// Which field supplies this data is a tool preference, not System data.
// `combatScalingField` is the GM's own explicit preference, if stored —
// empty/omitted falls through to guessCombatScalingFieldKey's guess, then
// the literal "combatScaling" key as the very last resort (never the ONLY
// option, since D&D 3.5e/5e or d20 Modern author it as "challengeRating").
export async function loadCombatScalingLevels(dataManager, systemId, combatScalingField = "") {
  if (!dataManager || !systemId) return [];
  try {
    // preferLocal: false — a Loom edit to the System's fields must be
    // visible immediately, not hidden behind a stale local cache. Same
    // reasoning as combat-tracker.js's System reads.
    const result = await dataManager.get("systems", systemId, { preferLocal: false });
    const fields = Array.isArray(result?.payload?.fields) ? result.payload.fields : [];
    const key = combatScalingField || guessCombatScalingFieldKey(fields) || "combatScaling";
    const field = fields.find((entry) => entry.type === "array" && entry.key === key);
    if (!field) return [];
    return (field.values || []).map((value, index) => ({
      id: value.id || slugify(value.name) || `combat-scaling-${index}`,
      name: value.name || value.label || String(value.id || index),
      // The real, portable display value (e.g. "1/2") — distinct from `id`
      // above, which is only ever an internal slug/matching key never meant
      // to be shown to a user. Falls back the same "always something usable"
      // way id/name do, for a value that doesn't author one.
      shortName: value.shortName || value.name || value.id || String(index),
      ...value,
    }));
  } catch (error) {
    return [];
  }
}
