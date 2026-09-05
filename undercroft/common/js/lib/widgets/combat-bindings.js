// Shared "resolve a combatant's starting stats from a System's combat
// bindings" logic, factored out of combat-tracker.js's own addCombatant()
// so Repository's `encounter:` block builder can resolve a matched
// Monster/NPC's HP/AC through the same paths instead of a second copy.
import { findBindingByRole, findBindingsByRole, findRoleBoundField } from "../bindings.js";
import { resolveDottedPath } from "../dotted-path.js";

// The tag vocabulary field and the combat-bindings field both live on the
// same System record's `fields` — one fetch serves both (see tag-editor.js's
// deriveConditionsVocabulary). preferLocal: false — a Loom edit must be visible immediately.
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

// Resolves one `resource`-role binding entry against a record's payload —
// shared by both the PRIMARY resource (hp/maxHp/tempHp below) and every
// secondary one (`resources` below). Returns null when nothing resolves,
// rather than a zeroed-out entry — a secondary resource with no real value
// shouldn't clutter `resources`, unlike the primary resource which always
// needs SOME hp/maxHp (Combat Tracker's manual-entry UI assumes it's present).
function resolveResourceValue(binding, payload) {
  if (!binding?.recordField) return null;
  const current = resolveDottedPath(payload, binding.recordField);
  // maxPath (bound to another field) and a literal `max` (a fixed ceiling,
  // e.g. Daggerheart's Hope: max 6) are both valid — maxPath wins when both are present.
  const max = binding.maxPath
    ? resolveDottedPath(payload, binding.maxPath)
    : typeof binding.max === "number"
      ? binding.max
      : undefined;
  let temp = 0;
  if (binding.tempPath) {
    const resolvedTemp = resolveDottedPath(payload, binding.tempPath);
    if (typeof resolvedTemp === "number") temp = resolvedTemp;
  }
  if (typeof max === "number") {
    return { name: binding.name || "", current: typeof current === "number" ? current : max, max, temp };
  }
  if (typeof current === "number") {
    return { name: binding.name || "", current, max: current, temp };
  }
  return null;
}

// Resolves a matched Library record's starting HP/AC/tempHp through the
// encounter's combat bindings — the same recordField paths
// writeThroughToCharacter uses to write back. Falls back to 0/0/0/0 for a
// System with no matching binding.
//
// A System can define MORE than one `resource`-role binding (e.g. d20
// Modern's Hit Points + Action Points). The FIRST one is still what
// `hp`/`maxHp`/`tempHp` mean below (Combat Tracker's HP UI assumes a single
// primary resource), but every OTHER resource-role binding also resolves
// into `resources` — read-only here, but real data Orrery's own "Marker
// Resource Bar" setting can read. `hpResourceName` is the primary
// resource's display name, carried so a consumer never has to separately fetch combatBindings.
export function resolveCombatantStats(combatBindings, payload) {
  let hp = 0;
  let maxHp = 0;
  let tempHp = 0;
  let ac = 0;
  let hpResourceName = "";
  const [primaryResource, ...secondaryResources] = findBindingsByRole(combatBindings, "resource");
  const value = findBindingByRole(combatBindings, "value");
  if (primaryResource) {
    hpResourceName = primaryResource.name || "";
    const resolved = resolveResourceValue(primaryResource, payload);
    if (resolved) {
      hp = resolved.current;
      maxHp = resolved.max;
      tempHp = resolved.temp;
    }
  }
  if (value?.recordField) {
    const resolvedValue = resolveDottedPath(payload, value.recordField);
    if (typeof resolvedValue === "number") ac = resolvedValue;
  }
  const resources = secondaryResources
    .map((binding) => resolveResourceValue(binding, payload))
    .filter(Boolean);
  return { hp, maxHp, tempHp, ac, hpResourceName, resources };
}

// Best-effort guess for which of a System's `resource`-role combatBindings
// should back Orrery's own Marker Resource Bar — used only to pre-fill that
// per-System settings preference when a GM hasn't explicitly chosen one,
// never the sole source of truth. Name-preference first (a System listing a
// narrative resource like Sanity ahead of Hit Points shouldn't silently
// default to the wrong one by array order), falling back to the FIRST
// resource-role entry, the same one resolveCombatantStats' hp/maxHp mean.
const BAR_RESOURCE_NAME_PREFERENCE = ["hit points", "hp", "health", "vitality"];

export function guessBarResourceName(resourceBindings) {
  const list = Array.isArray(resourceBindings) ? resourceBindings : [];
  if (!list.length) return "";
  const preferred = BAR_RESOURCE_NAME_PREFERENCE.map((name) =>
    list.find((entry) => (entry?.name || "").trim().toLowerCase() === name)
  ).find(Boolean);
  return (preferred || list[0]).name || "";
}
