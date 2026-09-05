// Data loading for Vault's reference data: the shared `feature` kind and the
// active System's `propertyTypes` field. Mirrors Crucible's tables.js.
// fetchKindEntriesForSystem filters by systemId server-side before reading any
// file (server/storage.py); the `.filter()` below stays as the correctness
// guarantee for when it falls back to an unfiltered fetch.
import { fetchKindEntriesForSystem } from "../../../common/js/lib/content-fetch.js";
import { resolveFieldRoles, resolveFieldRole } from "../../../common/js/lib/field-roles.js";

export async function listFeaturesForSystem(dataManager, systemId) {
  const entries = await fetchKindEntriesForSystem(dataManager, "feature", systemId);
  return entries
    .map((entry) => ({ id: entry.id, ...entry.entity }))
    .filter((entry) => {
      const ids = Array.isArray(entry.systemIds) ? entry.systemIds : [];
      return !systemId || !ids.length || ids.includes(systemId);
    });
}

// Vault's own generated-output kind — lets the Wonder picker (app.js) offer
// every saved wonder for the active System. Mirrors listMonstersForSystem.
export async function listWondersForSystem(dataManager, systemId) {
  const entries = await fetchKindEntriesForSystem(dataManager, "wonder", systemId);
  return entries
    .map((entry) => ({ id: entry.id, ...entry.entity }))
    .filter((entry) => {
      const ids = Array.isArray(entry.systemIds) ? entry.systemIds : [];
      return !systemId || !ids.length || ids.includes(systemId);
    });
}

function hasCostShape(value) {
  return typeof value?.cost === "number";
}

function slugify(name) {
  return String(name || "")
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/(^-|-$)/g, "");
}

// setsBudgetCeiling isn't System data — which field acts as the ceiling is
// the System's own explicit `fieldRoles` declaration (role "budgetCeiling")
// — see field-roles.js.
function toLegacyPropertyType(field, budgetCeilingKey) {
  return {
    id: field.key,
    label: field.label || field.key,
    setsBudgetCeiling: field.key === budgetCeilingKey,
    values: (field.values || []).filter(hasCostShape).map((value) => ({
      id: slugify(value.name),
      label: value.name,
      cost: value.cost,
    })),
  };
}

// propertyTypes lives on one System record — fetched via dataManager.get,
// same as Loom's own System editor. preferLocal: false so a Loom edit to
// the System's fields is visible immediately, not hidden behind a stale cache.
//
// Which fields are generator-property fields, and which one sets the budget
// ceiling, are both the System's own explicit `fieldRoles` declarations
// (roles "generatorProperty"/"budgetCeiling") — see field-roles.js. Without
// SOME ceiling resolving, every property type is treated as spend against
// the fixed DEFAULT_TARGET_BUDGET of 10 with nothing ever setting a real
// ceiling (confirmed cause of a "Target stuck at 10" bug).
export async function getSystemPropertyTypes(dataManager, systemId) {
  if (!dataManager || !systemId) return [];
  try {
    const result = await dataManager.get("systems", systemId, { preferLocal: false });
    const eligibleFields = resolveFieldRoles(result?.payload, "generatorProperty").map((entry) => entry.fieldDef);
    const budgetCeilingKey = resolveFieldRole(result?.payload, "budgetCeiling")?.sourceField || "";
    return eligibleFields.map((field) => toLegacyPropertyType(field, budgetCeilingKey));
  } catch (error) {
    return [];
  }
}

// A System's own casting classes — an ordinary array field keyed "classes"
// (also used by DDB-import lookups), NOT a generator-property field (no
// cost). A class's own `allowedFeatureTags` (matched against a
// Feature's `tags.propertyHints` by matchesClass, generator.js) lives in its
// Extra-properties JSON catch-all; absent on most classes and on any System
// with no "classes" field, in which case the Casting Class selector never shows.
export async function getSystemClasses(dataManager, systemId) {
  if (!dataManager || !systemId) return [];
  try {
    const result = await dataManager.get("systems", systemId, { preferLocal: false });
    const fields = Array.isArray(result?.payload?.fields) ? result.payload.fields : [];
    const field = fields.find((entry) => entry?.type === "array" && entry.key === "classes");
    const values = Array.isArray(field?.values) ? field.values : [];
    return values
      .filter((value) => value && typeof value.name === "string" && value.name)
      .map((value) => ({
        id: slugify(value.name),
        label: value.name,
        allowedFeatureTags: Array.isArray(value.allowedFeatureTags) ? value.allowedFeatureTags : null,
      }));
  } catch (error) {
    return [];
  }
}
