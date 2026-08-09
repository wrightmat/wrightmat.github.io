// Data loading for Vault's reference data: the shared `feature` kind
// (retrofitted with `tags.categories`, same Library kind Crucible reads) and
// the active System's `propertyTypes` field. Mirrors Crucible's tables.js.
import { fetchKindEntriesWithIds } from "../../../common/js/lib/content-fetch.js";

export async function listFeaturesForSystem(dataManager, systemId) {
  const entries = await fetchKindEntriesWithIds(dataManager, "feature");
  return entries
    .map((entry) => ({ id: entry.id, ...entry.entity }))
    .filter((entry) => {
      const ids = Array.isArray(entry.systemIds) ? entry.systemIds : [];
      return !systemId || !ids.length || ids.includes(systemId);
    });
}

// Generator properties (Rarity, Activation, Item Form, ...) are just ordinary
// array-type fields on a System record's `fields` (Loom's "Properties"
// editor) — no separate "propertyTypes" concept exists anymore. A field
// counts as a generator property when every one of its values carries a
// numeric `cost` or `targetBudget`; this is translated to the legacy
// `{id, label, setsBudgetCeiling, values: [{id, label, cost, targetBudget}]}`
// shape below so the rest of Vault (app.js, generator.js) needs no changes.
function isGeneratorPropertyField(field) {
  if (!field || field.type !== "array") return false;
  const values = Array.isArray(field.values) ? field.values : [];
  return values.length > 0 && values.every((value) => typeof value.cost === "number" || typeof value.targetBudget === "number");
}

function slugify(name) {
  return String(name || "")
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/(^-|-$)/g, "");
}

// setsBudgetCeiling isn't System data at all — which field acts as the
// ceiling is Vault's own tool-level preference (which field Vault's
// generator should treat specially), not part of the game system's schema.
// It's supplied here by the caller (see vault/js/app.js's local
// budgetCeilingField preference, stored per System in this browser) rather
// than read off the System record.
function toLegacyPropertyType(field, budgetCeilingField) {
  return {
    id: field.key,
    label: field.label || field.key,
    setsBudgetCeiling: field.key === budgetCeilingField,
    values: (field.values || []).map((value) => ({
      id: slugify(value.name),
      label: value.name,
      cost: value.cost,
      targetBudget: value.targetBudget,
    })),
  };
}

// propertyTypes lives on one specific System record, not a systemId-filtered
// list of a kind's entries — fetched directly via dataManager.get, the same
// way Loom's own System editor reads a System record.
// preferLocal: false — a Loom edit to the System's fields must be visible
// immediately, not hidden behind a stale local cache. Same reasoning as
// combat-tracker.js's System reads.
export async function getSystemPropertyTypes(dataManager, systemId, budgetCeilingField = "") {
  if (!dataManager || !systemId) return [];
  try {
    const result = await dataManager.get("systems", systemId, { preferLocal: false });
    const fields = Array.isArray(result?.payload?.fields) ? result.payload.fields : [];
    return fields.filter(isGeneratorPropertyField).map((field) => toLegacyPropertyType(field, budgetCeilingField));
  } catch (error) {
    return [];
  }
}

// A System's own casting classes (Wizard, Cleric, ...) — an ordinary array
// field with the conventional key "classes" (already used by DDB-import
// lookups, `common/data/system/sys.dnd5e.json`), NOT a generator-property
// field (its values carry no cost/targetBudget, so isGeneratorPropertyField
// above correctly never picks it up). A class's own `allowedFeatureTags`
// (matched against a Feature's `tags.propertyHints` by matchesClass,
// `vault/js/lib/generator.js`) lives in that value's Extra properties (JSON)
// catch-all, same as every other one-off per-value field in this suite —
// absent on most classes (a non-caster like Fighter has nothing to
// restrict) and absent entirely on any System with no "classes" field at
// all (most Systems), in which case Vault simply never shows the Casting
// Class selector.
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
