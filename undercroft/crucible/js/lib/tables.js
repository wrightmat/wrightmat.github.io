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
export async function loadCombatScalingLevels(dataManager, systemId) {
  if (!dataManager || !systemId) return [];
  try {
    const result = await dataManager.get("systems", systemId);
    const fields = Array.isArray(result?.payload?.fields) ? result.payload.fields : [];
    const field = fields.find((entry) => entry.type === "array" && entry.key === "combatScaling");
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
