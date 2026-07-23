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

function toLegacyPropertyType(field) {
  return {
    id: field.key,
    label: field.label || field.key,
    setsBudgetCeiling: !!field.setsBudgetCeiling,
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
export async function getSystemPropertyTypes(dataManager, systemId) {
  if (!dataManager || !systemId) return [];
  try {
    const result = await dataManager.get("systems", systemId);
    const fields = Array.isArray(result?.payload?.fields) ? result.payload.fields : [];
    return fields.filter(isGeneratorPropertyField).map(toLegacyPropertyType);
  } catch (error) {
    return [];
  }
}
