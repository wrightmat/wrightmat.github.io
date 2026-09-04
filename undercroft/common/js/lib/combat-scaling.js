// Shared "read a System's own Combat Scaling data" helper — originally
// Crucible-only, moved here once the Dashboard's Encounter Difficulty & XP
// calculator needed the exact same lookup. Crucible's tables.js now
// imports and re-exports this instead of defining it locally.
import { resolveFieldRole } from "./field-roles.js";

export function slugify(name) {
  return String(name || "")
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/(^-|-$)/g, "");
}

// combatScaling is an ordinary array field on the active System's `fields`
// — same mechanism as Vault's generator-property fields, but unlike those,
// each value is a full scaling level (CR, Tier, ...) with concrete target
// stats, returned close to as-authored (just adding a slugified `id`) so
// `hitPoints`/`armorClass`/`xp`/etc. survive. Not auto-seeded on new
// Systems — absent means no scaling data, "derive nothing" not an error.
//
// Which field supplies this data is the System's own explicit `fieldRoles`
// declaration (role "combatScaling") — see field-roles.js.
export async function loadCombatScalingLevels(dataManager, systemId) {
  if (!dataManager || !systemId) return [];
  try {
    // preferLocal: false — a Loom edit to the System's fields must be
    // visible immediately, not hidden behind a stale local cache. Same
    // reasoning as combat-tracker.js's System reads.
    const result = await dataManager.get("systems", systemId, { preferLocal: false });
    const field = resolveFieldRole(result?.payload, "combatScaling")?.fieldDef;
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
