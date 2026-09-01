// Data loading for Crucible's reference kinds — monster-archetype,
// monster-role, feature — all managed in Loom's generic Library tab, not
// authored here. Mirrors Forge's tables.js: fetchKindEntriesForSystem
// (common/js/lib/content-fetch.js) lists a kind's saved entries, already
// narrowed to the active System server-side, and pairs each with its id.
// Creature Type is NOT one of these — see listCreatureTypesForSystem below.
import { fetchKindEntriesForSystem } from "../../../common/js/lib/content-fetch.js";
// loadCombatScalingLevels moved to common/js/lib/combat-scaling.js once the
// Dashboard's Encounter Difficulty & XP calculator needed the exact same
// System-reading logic — re-exported below so every existing importer of
// this module keeps working unchanged. slugify moved with it since
// loadCombatScalingLevels (and this file's other lookups) depend on it.
import { slugify, loadCombatScalingLevels, guessCombatScalingFieldKey } from "../../../common/js/lib/combat-scaling.js";
// loadAbilityFieldDefs moved to common/js/lib/generator-kit.js once Vault
// needed the exact same System-ability-reading logic (its own feature-
// params-editor ability select) — re-exported below so every existing
// importer of this module keeps working unchanged.
import { loadAbilityFieldDefs } from "../../../common/js/lib/generator-kit.js";

export { loadCombatScalingLevels, loadAbilityFieldDefs, guessCombatScalingFieldKey };

// fetchKindEntriesForSystem asks the server to filter by systemId before
// reading any file (get_items_bulk, server/storage.py) rather than fetching
// a kind's whole cross-tool library and filtering client-side — the
// `.filter()` below stays regardless, as the correctness guarantee for the
// case fetchKindEntriesForSystem itself falls back to an unfiltered fetch.
async function listKindForSystem(dataManager, kind, systemId) {
  const entries = await fetchKindEntriesForSystem(dataManager, kind, systemId);
  return entries
    .map((entry) => ({ id: entry.id, ...entry.entity }))
    .filter((entry) => {
      const ids = Array.isArray(entry.systemIds) ? entry.systemIds : [];
      return !systemId || !ids.length || ids.includes(systemId);
    });
}

// Unlike Archetype/Role/Feature (Crucible-authored reference data, shared
// across every System), Creature Type is System-defined game-rule
// vocabulary — what "creature type" even means, and the full taxonomy of
// them, is a per-system rules concept the same way Languages or Classes
// are, not something Crucible should own one shared Library-kind list of.
// Reads straight off the active System's own array field (Loom's Properties
// editor) — same mechanism as loadCombatScalingLevels below, including
// "values returned close to as-authored, just adding a slugified `id`
// fallback" so existing content (Features tagged by creature-type id, e.g.
// "beast") keeps resolving correctly. Absent on a System means no creature
// types defined, which callers should treat as "nothing eligible" rather
// than an error.
//
// Which field supplies this data is Crucible's own tool preference, not
// System data — different systems use different nomenclature for this
// concept (5e's "Creature Type" vocabulary, another game's "Kind"/"Origin"/
// whatever it calls its own version) — so it's configurable exactly like
// combatScalingField below (see getCreatureTypeFieldPreference in app.js).
// `creatureTypeField` is the GM's own explicit preference, if stored —
// empty/omitted falls through to guessCreatureTypeFieldKey's own name-
// preference guess, then the literal "creatureTypes" key as the last
// resort, so existing Systems keep working without needing to set anything.
const CREATURE_TYPE_FIELD_NAME_PREFERENCE = ["creatureTypes"];

// See guessCombatScalingFieldKey's own comment (common/js/lib/combat-
// scaling.js) for why this is name-preference only, not shape-detected —
// "creatureTypes" is overwhelmingly the real convention across this suite's
// own Systems (every one surveyed that has this concept at all, as of
// 2026-08-30, uses that exact name), so the list is short today, but kept
// as a real preference list (not a single hardcoded string) so a future
// System's own alternate name has an obvious place to be added.
export function guessCreatureTypeFieldKey(fields) {
  const arrayFieldKeys = new Set((Array.isArray(fields) ? fields : []).filter((f) => f?.type === "array").map((f) => f.key));
  return CREATURE_TYPE_FIELD_NAME_PREFERENCE.find((name) => arrayFieldKeys.has(name)) || "";
}

export async function listCreatureTypesForSystem(dataManager, systemId, creatureTypeField = "") {
  if (!dataManager || !systemId) return [];
  try {
    // preferLocal: false — a Loom edit to the System's fields must be
    // visible immediately, not hidden behind a stale local cache.
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

// Crucible's own generated-output kind — lets the Monster picker (app.js)
// offer every previously-saved monster for the active System, the same way
// Sanctum's Location picker lists saved Locations for the active Setting.
export async function listMonstersForSystem(dataManager, systemId) {
  return listKindForSystem(dataManager, "monster", systemId);
}

// Every top-level array field, so Crucible's "Combat scaling field"/
// "Creature type field" tool preference dropdowns can list all real
// candidates — deliberately not filtered by shape (unlike Vault's
// cost/targetBudget-based isGeneratorPropertyField) since a scaling field's
// own shape is whatever stats this System's generator actually needs, not a
// fixed set this function could check for. `guessedCombatScalingKey`/
// `guessedCreatureTypeKey` ride along (computed here, in the same fetch,
// rather than a second round trip) so each settings dropdown can pre-select
// its own guess and label it as auto-detected — mirrors
// listObjectFieldOptions's own `guessedKey` (common/js/lib/generator-kit.js)
// for abilityField.
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

// damageTypes reads exactly like Combat Tracker's `conditions` field
// (common/js/lib/widgets/combat-tracker.js#loadConditionsPropertyType) — a
// plain tag-suggestion list, not a generator property (no cost/targetBudget
// on its values).
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
