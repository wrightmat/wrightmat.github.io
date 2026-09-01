// Shared "read a System's own Combat Scaling data" helper — originally
// Crucible-only (undercroft/crucible/js/lib/tables.js), moved here once the
// Dashboard's Encounter Difficulty & XP calculator needed the exact same
// lookup: reusing this function (and Crucible's own configured field-name
// preference, see calculator-modes/encounter-xp.js) is what "use the same
// Combat Scaling option as Crucible" means, rather than a second, separately
// maintained copy of this logic. Crucible's own tables.js now imports and
// re-exports this instead of defining it locally, so nothing else in
// Crucible had to change.

export function slugify(name) {
  return String(name || "")
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/(^-|-$)/g, "");
}

// Best-effort guess for which array field IS a System's Combat Scaling data,
// used only to pre-fill the combatScalingField settings preference below
// when a GM hasn't explicitly chosen one yet — never the sole source of
// truth (see feedback_settings_preference_with_guessed_default). Unlike
// guessAbilityFieldKey (common/js/lib/generator-kit.js), there's no reliable
// SHAPE signature here — a scaling field's own value shape is whatever
// stats that System's generator needs (D&D's CR carries armorClass/
// hitPoints/attackBonus/saveDC, Daggerheart's Tier carries none of that) —
// so this is name-preference only, checked against whatever array fields
// the System actually defines. The three names below are every real one
// found across this suite's own Systems as of 2026-08-30: "combatScaling"
// (the majority, and the literal hardcoded default every loader here already
// falls back to), "challengeRating" (D&D 3.5e/5e/5e2014, Pathfinder 1E,
// Starfinder 1E, d20 Modern — a confirmed real, recurring alternate name,
// not a one-off), and "tier" (Daggerheart).
const COMBAT_SCALING_FIELD_NAME_PREFERENCE = ["combatScaling", "challengeRating", "tier"];

export function guessCombatScalingFieldKey(fields) {
  const arrayFieldKeys = new Set((Array.isArray(fields) ? fields : []).filter((f) => f?.type === "array").map((f) => f.key));
  return COMBAT_SCALING_FIELD_NAME_PREFERENCE.find((name) => arrayFieldKeys.has(name)) || "";
}

// combatScaling is an ordinary array field on the active System's `fields`
// (Loom's Properties editor) — same mechanism as Vault's generator-property
// fields (see vault/js/lib/tables.js#getSystemPropertyTypes), but unlike
// those, its values carry more than {cost, targetBudget}: each one is a full
// scaling level (CR, Tier, ...) with concrete target stats. Values are
// returned close to as-authored (just adding a slugified `id`) rather than
// translated to Vault's stripped-down legacy shape, so `hitPoints`/
// `armorClass`/`xp`/etc. survive. Not auto-seeded on new Systems (see
// sys.dnd5e.json's own copy) — absent on a System means no scaling data,
// which callers should treat as "derive nothing, or a bare minimum" rather
// than an error.
//
// Which field supplies this data is a tool preference (like Vault's Budget
// ceiling field — see vault/js/app.js), not System data: a different
// generator entirely might not care about combat scaling at all, or a
// System might want to reuse the same field for a different purpose.
// `combatScalingField` is the GM's own explicit preference, if stored —
// empty/omitted falls through to guessCombatScalingFieldKey's own name-
// preference guess, then the literal "combatScaling" key as the very last
// resort (the old, sole hardcoded assumption, kept only as the final
// fallback now — never hardcoded as the only option, since a System like
// D&D 3.5e/5e or d20 Modern authors its scaling data under a completely
// different key, "challengeRating").
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
