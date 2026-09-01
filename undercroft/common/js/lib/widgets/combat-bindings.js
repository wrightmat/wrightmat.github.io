// Shared "resolve a combatant's starting stats from a System's combat
// bindings" logic — originally private to combat-tracker.js's own
// addCombatant(), factored out here so Repository's `encounter:` block
// builder (repository/js/lib/journal-encounter.js) can resolve a matched
// Monster/NPC's HP/AC through the exact same System-specific paths, instead
// of a second hand-written copy.
import { resolveBinding, findBindingByRole, findBindingsByRole, findRoleBoundField } from "../bindings.js";

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

// Resolves one `resource`-role binding entry against a record's payload —
// shared by both the PRIMARY resource (hp/maxHp/tempHp below) and every
// secondary one (the `resources` array below), so the maxPath-vs-literal-max
// convention (see its own comment) is only ever implemented once. Returns
// null when nothing at all resolves, rather than a zeroed-out entry — a
// secondary resource with no real value shouldn't clutter `resources` with
// a meaningless 0/0 row (unlike the primary resource, which always needs
// SOME hp/maxHp, even if 0, since Combat Tracker's own manual-entry UI is
// built around it always being present).
function resolveResourceValue(binding, payload) {
  if (!binding?.binding) return null;
  const current = resolveBinding(binding.binding, payload);
  // maxPath (bound to another field, e.g. D&D's Hit Points) and a literal
  // `max` (a fixed ceiling, e.g. Daggerheart's Hope: max 6) are both real,
  // valid conventions — maxPath wins when both are somehow present, since
  // it points at the record's own live value.
  const max = binding.maxPath
    ? resolveBinding(binding.maxPath, payload)
    : typeof binding.max === "number"
      ? binding.max
      : undefined;
  let temp = 0;
  if (binding.tempPath) {
    const resolvedTemp = resolveBinding(binding.tempPath, payload);
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
// encounter's own combat bindings — the same resolveBinding paths
// writeThroughToCharacter uses to write back. Falls back to 0/0/0/0 (the
// existing manual-entry default) for a System with no matching binding, or a
// record with nothing at that path.
//
// A System can define MORE than one `resource`-role binding (e.g. d20
// Modern's Hit Points + Action Points, Daggerheart's Hope alongside HP) —
// see findBindingsByRole's own comment in bindings.js. The FIRST one is
// still what `hp`/`maxHp`/`tempHp` mean below (Combat Tracker's own HP
// input/edit UI is built around a single primary resource, unchanged from
// before this existed), but every OTHER resource-role binding now also
// resolves into `resources` — read-only here (no edit UI for a secondary
// resource in Combat Tracker itself), but real, live data a different
// consumer (Orrery's own per-System "which resource is the Marker Resource Bar"
// setting) can read. `hpResourceName` is the primary resource's own display
// name (e.g. "Hit Points"), carried alongside so a consumer never has to
// separately fetch this System's combatBindings just to know what `hp`
// itself actually represents.
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
  if (value?.binding) {
    const resolvedValue = resolveBinding(value.binding, payload);
    if (typeof resolvedValue === "number") ac = resolvedValue;
  }
  const resources = secondaryResources
    .map((binding) => resolveResourceValue(binding, payload))
    .filter(Boolean);
  return { hp, maxHp, tempHp, ac, hpResourceName, resources };
}

// Best-effort guess for which of a System's `resource`-role combatBindings
// entries should back Orrery's own Marker Resource Bar (the small bar shown
// above a combatant's map marker — not necessarily HP; a System can point it
// at any resource, e.g. d20 Modern's Action Points), used only to pre-fill
// that per-System settings preference when a GM hasn't explicitly chosen one
// yet — never the sole source of truth (see
// feedback_settings_preference_with_guessed_default). Name-preference
// first (a System that lists a narrative resource like Sanity or Stress
// ahead of Hit Points shouldn't silently default the bar to the wrong one
// just because of array order), falling back to the FIRST resource-role
// entry — the same one Combat Tracker's own hp/maxHp already mean (see
// resolveCombatantStats above) — which is exactly what "default to Current
// HP as a fraction of Max HP" means for a System with no clearly HP-named
// resource at all.
const BAR_RESOURCE_NAME_PREFERENCE = ["hit points", "hp", "health", "vitality"];

export function guessBarResourceName(resourceBindings) {
  const list = Array.isArray(resourceBindings) ? resourceBindings : [];
  if (!list.length) return "";
  const preferred = BAR_RESOURCE_NAME_PREFERENCE.map((name) =>
    list.find((entry) => (entry?.name || "").trim().toLowerCase() === name)
  ).find(Boolean);
  return (preferred || list[0]).name || "";
}
