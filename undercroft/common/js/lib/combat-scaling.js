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
// Defaults to "combatScaling" so existing Systems keep working without
// needing to set anything.
export async function loadCombatScalingLevels(dataManager, systemId, combatScalingField = "combatScaling") {
  if (!dataManager || !systemId || !combatScalingField) return [];
  try {
    // preferLocal: false — a Loom edit to the System's fields must be
    // visible immediately, not hidden behind a stale local cache. Same
    // reasoning as combat-tracker.js's System reads.
    const result = await dataManager.get("systems", systemId, { preferLocal: false });
    const fields = Array.isArray(result?.payload?.fields) ? result.payload.fields : [];
    const field = fields.find((entry) => entry.type === "array" && entry.key === combatScalingField);
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
