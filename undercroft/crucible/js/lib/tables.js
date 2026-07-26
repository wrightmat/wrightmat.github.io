// Data loading for Crucible's four reference kinds — creature-type, archetype,
// role, feature — all managed in Loom's generic Library tab, not authored
// here. Mirrors Forge's tables.js: fetchKindEntriesWithIds (promoted to
// common/js/lib/content-fetch.js this pass, since Forge and Loom each had
// their own copy already) lists a kind's saved entries and pairs each with
// its id, since the generic listing route only returns ids, not full bodies.
import { fetchKindEntriesWithIds } from "../../../common/js/lib/content-fetch.js";

async function listKindForSystem(dataManager, kind, systemId) {
  const entries = await fetchKindEntriesWithIds(dataManager, kind);
  return entries
    .map((entry) => ({ id: entry.id, ...entry.entity }))
    .filter((entry) => {
      const ids = Array.isArray(entry.systemIds) ? entry.systemIds : [];
      return !systemId || !ids.length || ids.includes(systemId);
    });
}

export async function listCreatureTypesForSystem(dataManager, systemId) {
  return listKindForSystem(dataManager, "creature-type", systemId);
}

export async function listArchetypesForSystem(dataManager, systemId) {
  return listKindForSystem(dataManager, "archetype", systemId);
}

export async function listRolesForSystem(dataManager, systemId) {
  return listKindForSystem(dataManager, "role", systemId);
}

export async function listFeaturesForSystem(dataManager, systemId) {
  return listKindForSystem(dataManager, "feature", systemId);
}

function slugify(name) {
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
// `armorClass`/etc. survive. Not auto-seeded on new Systems (see
// sys.dnd5e.json's own copy) — absent on a System means no scaling data,
// which callers should treat as "derive nothing, or a bare minimum" rather
// than an error.
//
// Which field supplies this data is Crucible's own tool preference (like
// Vault's Budget ceiling field — see vault/js/app.js), not System data: a
// different generator entirely might not care about combat scaling at all,
// or a System might want to reuse the same field for a different purpose.
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
      ...value,
    }));
  } catch (error) {
    return [];
  }
}

// Every top-level array field, so Crucible's "Combat scaling field" tool
// preference dropdown can list all real candidates — deliberately not
// filtered by shape (unlike Vault's cost/targetBudget-based
// isGeneratorPropertyField) since a scaling field's own shape is whatever
// stats this System's generator actually needs, not a fixed set this
// function could check for.
export async function listArrayFieldOptions(dataManager, systemId) {
  if (!dataManager || !systemId) return [];
  try {
    const result = await dataManager.get("systems", systemId, { preferLocal: false });
    const fields = Array.isArray(result?.payload?.fields) ? result.payload.fields : [];
    return fields
      .filter((entry) => entry.type === "array")
      .map((entry) => ({ key: entry.key, label: entry.label || entry.key }));
  } catch (error) {
    return [];
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
