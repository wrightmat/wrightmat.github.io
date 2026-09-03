// Data loading for Sanctum's reference kinds (location-type, location-purpose,
// feature, resource, species) plus Setting/Location, via fetchKindEntriesForSystem
// (content-fetch.js) — the same server-filtered bulk loader other generators use.
// Sanctum is the sole authoring surface for setting/location (Loom's old Places
// panel is retired), so reads must see the signed-in user's own private records.
import { fetchKindEntriesForSystem, listLocationsForSetting } from "../../../common/js/lib/content-fetch.js";

// Re-exported so app.js's import from this file keeps working — the
// implementation moved to content-fetch.js since Forge's copy was identical.
export { listLocationsForSetting };

// fetchKindEntriesForSystem filters server-side before reading any file
// (server/storage.py); the `.filter()` below stays as the correctness
// guarantee for when it falls back to an unfiltered fetch.
async function listKindForSystem(dataManager, kind, systemId) {
  const entries = await fetchKindEntriesForSystem(dataManager, kind, systemId);
  return entries
    .map((entry) => ({ id: entry.id, ...entry.entity }))
    .filter((entry) => {
      const ids = Array.isArray(entry.systemIds) ? entry.systemIds : [];
      return !systemId || !ids.length || ids.includes(systemId);
    });
}

export async function listLocationTypesForSystem(dataManager, systemId) {
  return listKindForSystem(dataManager, "location-type", systemId);
}

export async function listLocationPurposesForSystem(dataManager, systemId) {
  return listKindForSystem(dataManager, "location-purpose", systemId);
}

export async function listFeaturesForSystem(dataManager, systemId) {
  return listKindForSystem(dataManager, "feature", systemId);
}

export async function listResourcesForSystem(dataManager, systemId) {
  return listKindForSystem(dataManager, "resource", systemId);
}

export async function listSpeciesForSystem(dataManager, systemId) {
  return listKindForSystem(dataManager, "species", systemId);
}

// Other Library kinds an Asset/Need entry can reference by id — cached like
// Features/Resources so a description can be looked up without a re-fetch per row.
export async function listNpcsForSystem(dataManager, systemId) {
  return listKindForSystem(dataManager, "npc", systemId);
}

export async function listMonstersForSystem(dataManager, systemId) {
  return listKindForSystem(dataManager, "monster", systemId);
}

export async function listWondersForSystem(dataManager, systemId) {
  return listKindForSystem(dataManager, "wonder", systemId);
}

// Setting uses `systemIds` like every other kind now, so this is just
// listKindForSystem under a Setting-specific name — except it keeps the
// "no systemId means no results" guard (listKindForSystem's own filter
// would otherwise treat a blank systemId as "match everything").
export async function listSettingsForSystem(dataManager, systemId) {
  if (!systemId) return [];
  return listKindForSystem(dataManager, "setting", systemId);
}

