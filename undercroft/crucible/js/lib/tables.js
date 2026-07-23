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
