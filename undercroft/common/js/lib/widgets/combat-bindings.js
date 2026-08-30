// Shared "resolve a combatant's starting stats from a System's combat
// bindings" logic — originally private to combat-tracker.js's own
// addCombatant(), factored out here so Repository's `encounter:` block
// builder (repository/js/lib/journal-encounter.js) can resolve a matched
// Monster/NPC's HP/AC through the exact same System-specific paths, instead
// of a second hand-written copy.
import { resolveBinding, findBindingByRole, findRoleBoundField } from "../bindings.js";

// The tag vocabulary field and the combat-bindings field both live on the
// same System record's `fields` — one fetch serves both (see tag-editor.js's
// deriveConditionsVocabulary, the other consumer of this same fetch).
// `preferLocal: false` — a Loom edit to a System's fields must be visible
// immediately, not hidden behind a stale local cache.
export async function loadSystemFields(dataManager, systemId) {
  if (!systemId) return null;
  try {
    const result = await dataManager.get("system", systemId, { preferLocal: false });
    return Array.isArray(result?.payload?.fields) ? result.payload.fields : [];
  } catch (error) {
    return null;
  }
}

// Combat Bindings isn't a field type of its own — it's just whichever
// ordinary Enum-mode array field's values happen to use Role (see
// findRoleBoundField in bindings.js): "resource" (HP), "value" (AC),
// "tags" (Conditions), "modifier" (Initiative).
export function deriveCombatBindings(fields) {
  if (!fields) return null;
  const field = findRoleBoundField(fields);
  return field && Array.isArray(field.values) ? field.values : null;
}

// Resolves a matched Library record's starting HP/AC/tempHp through the
// encounter's own combat bindings — the same resolveBinding paths
// writeThroughToCharacter uses to write back. Falls back to 0/0/0/0 (the
// existing manual-entry default) for a System with no matching binding, or a
// record with nothing at that path.
export function resolveCombatantStats(combatBindings, payload) {
  let hp = 0;
  let maxHp = 0;
  let tempHp = 0;
  let ac = 0;
  const resource = findBindingByRole(combatBindings, "resource");
  const value = findBindingByRole(combatBindings, "value");
  if (resource?.binding) {
    const current = resolveBinding(resource.binding, payload);
    // maxPath (bound to another field, e.g. D&D's Hit Points) and a literal
    // `max` (a fixed ceiling, e.g. Daggerheart's Hope: max 6) are both real,
    // valid conventions — maxPath wins when both are somehow present, since
    // it points at the record's own live value.
    const max = resource.maxPath
      ? resolveBinding(resource.maxPath, payload)
      : typeof resource.max === "number"
        ? resource.max
        : undefined;
    if (typeof max === "number") {
      maxHp = max;
      hp = typeof current === "number" ? current : maxHp;
    } else if (typeof current === "number") {
      hp = current;
      maxHp = current;
    }
    if (resource.tempPath) {
      const temp = resolveBinding(resource.tempPath, payload);
      if (typeof temp === "number") tempHp = temp;
    }
  }
  if (value?.binding) {
    const resolvedValue = resolveBinding(value.binding, payload);
    if (typeof resolvedValue === "number") ac = resolvedValue;
  }
  return { hp, maxHp, tempHp, ac };
}
