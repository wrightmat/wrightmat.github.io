// Data loading for Sanctum's reference kinds — location-type, location-purpose,
// feature (category "location"), resource, species (for the optional NPC
// Generation Config section) — plus Setting/Location themselves, all managed
// generically via fetchKindEntriesForSystem (common/js/lib/content-fetch.js), the
// authenticated-aware, server-side-System-filtered bulk loader every other
// generator tool already uses.
// Sanctum is now the sole authoring surface for setting/location (Loom's old
// Places panel is retired), so every read here must see the signed-in user's own
// private/unpublished records, not just public ones — dataManager-backed throughout.
import { fetchKindEntriesForSystem, listLocationsForSetting } from "../../../common/js/lib/content-fetch.js";

// Re-exported so undercroft/sanctum/js/app.js's own import (from this file)
// keeps working unchanged — the implementation moved to content-fetch.js
// since Forge's own copy was byte-identical (both list Locations for a
// Setting, both need the same pre-migration scalar-settingId fallback).
export { listLocationsForSetting };

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

// The other Library kinds an Asset/Need entry can reference by id — cached
// the same way Features/Resources are, so a saved Asset/Need's description
// can always be looked up locally rather than re-fetched per row render.
export async function listNpcsForSystem(dataManager, systemId) {
  return listKindForSystem(dataManager, "npc", systemId);
}

export async function listMonstersForSystem(dataManager, systemId) {
  return listKindForSystem(dataManager, "monster", systemId);
}

export async function listEffectsForSystem(dataManager, systemId) {
  return listKindForSystem(dataManager, "effect", systemId);
}

// Setting now uses `systemIds` (a plural array) exactly like every other
// kind — no more separate systemId-scalar special case — so this is just
// listKindForSystem under a Setting-specific name. Keeps the original
// "no systemId means no results at all" behavior (listKindForSystem's own
// filter would otherwise treat a blank systemId as "match everything").
export async function listSettingsForSystem(dataManager, systemId) {
  if (!systemId) return [];
  return listKindForSystem(dataManager, "setting", systemId);
}

