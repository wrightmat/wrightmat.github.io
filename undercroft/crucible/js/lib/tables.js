// Data loading for Crucible's reference kinds — monster-archetype,
// monster-role, feature — all managed in Loom's generic Library tab, not
// authored here. Creature Type is NOT one of these — see
// listCreatureTypesForSystem below.
import { fetchKindEntriesForSystem } from "../../../common/js/lib/content-fetch.js";
// Re-exported: loadCombatScalingLevels/guessCombatScalingFieldKey live in
// combat-scaling.js (shared with the Dashboard's XP calculator);
// loadAbilityFieldDefs lives in generator-kit.js (shared with Vault) — kept
// re-exported here so existing importers of this module still work.
import { slugify, loadCombatScalingLevels, guessCombatScalingFieldKey } from "../../../common/js/lib/combat-scaling.js";
import { loadAbilityFieldDefs } from "../../../common/js/lib/generator-kit.js";

export { loadCombatScalingLevels, loadAbilityFieldDefs, guessCombatScalingFieldKey };

// fetchKindEntriesForSystem filters by systemId server-side; the `.filter()`
// below stays as the correctness guarantee for when it falls back to an
// unfiltered fetch.
async function listKindForSystem(dataManager, kind, systemId) {
  const entries = await fetchKindEntriesForSystem(dataManager, kind, systemId);
  return entries
    .map((entry) => ({ id: entry.id, ...entry.entity }))
    .filter((entry) => {
      const ids = Array.isArray(entry.systemIds) ? entry.systemIds : [];
      return !systemId || !ids.length || ids.includes(systemId);
    });
}

// Unlike Archetype/Role/Feature, Creature Type is System-defined game-rule
// vocabulary — a per-system rules concept like Languages or Classes, not a
// shared Library-kind list Crucible owns. Reads straight off the active
// System's own array field, same mechanism as loadCombatScalingLevels below
// (values returned close to as-authored, plus a slugified `id` fallback so
// content tagged by creature-type id, e.g. "beast", keeps resolving).
// Absent on a System means "nothing eligible", not an error.
//
// Which field supplies this data is Crucible's own tool preference, not
// System data (systems name this concept differently) — configurable like
// combatScalingField below. `creatureTypeField` is the GM's stored
// preference; empty falls through to guessCreatureTypeFieldKey's guess,
// then the literal "creatureTypes" key.
const CREATURE_TYPE_FIELD_NAME_PREFERENCE = ["creatureTypes"];

// Name-preference only, not shape-detected — "creatureTypes" is the
// overwhelming real convention across this suite's own Systems today, but
// kept as a list (not a hardcoded string) so an alternate name has a place.
export function guessCreatureTypeFieldKey(fields) {
  const arrayFieldKeys = new Set((Array.isArray(fields) ? fields : []).filter((f) => f?.type === "array").map((f) => f.key));
  return CREATURE_TYPE_FIELD_NAME_PREFERENCE.find((name) => arrayFieldKeys.has(name)) || "";
}

export async function listCreatureTypesForSystem(dataManager, systemId, creatureTypeField = "") {
  if (!dataManager || !systemId) return [];
  try {
    const result = await dataManager.get("systems", systemId, { preferLocal: false });
    const fields = Array.isArray(result?.payload?.fields) ? result.payload.fields : [];
    const key = creatureTypeField || guessCreatureTypeFieldKey(fields) || "creatureTypes";
    const field = fields.find((entry) => entry.type === "array" && entry.key === key);
    if (!field) return [];
    return (field.values || []).map((value, index) => ({
      id: value.id || slugify(value.name) || `creature-type-${index}`,
      name: value.name || value.label || String(value.id || index),
      ...value,
    }));
  } catch (error) {
    return [];
  }
}

export async function listArchetypesForSystem(dataManager, systemId) {
  return listKindForSystem(dataManager, "monster-archetype", systemId);
}

export async function listRolesForSystem(dataManager, systemId) {
  return listKindForSystem(dataManager, "monster-role", systemId);
}

export async function listFeaturesForSystem(dataManager, systemId) {
  return listKindForSystem(dataManager, "feature", systemId);
}

// Lets the Monster picker offer every previously-saved monster for the
// active System, same as Sanctum's Location picker.
export async function listMonstersForSystem(dataManager, systemId) {
  return listKindForSystem(dataManager, "monster", systemId);
}

// Every top-level array field, so Crucible's "Combat scaling field"/
// "Creature type field" preference dropdowns can list all real candidates —
// not filtered by shape (unlike Vault's cost/targetBudget-based check) since
// a scaling field's shape varies per System. `guessedCombatScalingKey`/
// `guessedCreatureTypeKey` ride along in the same fetch so each dropdown can
// pre-select its own guess and label it auto-detected.
export async function listArrayFieldOptions(dataManager, systemId) {
  if (!dataManager || !systemId) return { options: [], guessedCombatScalingKey: "", guessedCreatureTypeKey: "" };
  try {
    const result = await dataManager.get("systems", systemId, { preferLocal: false });
    const fields = Array.isArray(result?.payload?.fields) ? result.payload.fields : [];
    const options = fields
      .filter((entry) => entry.type === "array")
      .map((entry) => ({ key: entry.key, label: entry.label || entry.key }));
    return {
      options,
      guessedCombatScalingKey: guessCombatScalingFieldKey(fields),
      guessedCreatureTypeKey: guessCreatureTypeFieldKey(fields),
    };
  } catch (error) {
    return { options: [], guessedCombatScalingKey: "", guessedCreatureTypeKey: "" };
  }
}

// damageTypes reads like Combat Tracker's `conditions` field — a plain
// tag-suggestion list, not a generator property (no cost/targetBudget).
export async function loadDamageTypesPropertyType(dataManager, systemId) {
  if (!dataManager || !systemId) return [];
  try {
    const result = await dataManager.get("systems", systemId);
    const fields = Array.isArray(result?.payload?.fields) ? result.payload.fields : [];
    const field = fields.find((entry) => entry.type === "array" && entry.key === "damageTypes");
    if (!field) return [];
    return (field.values || []).map((value, index) => ({
      id: value.id || slugify(value.name) || `damage-type-${index}`,
      label: value.name || value.label || String(value.id || index),
    }));
  } catch (error) {
    return [];
  }
}
