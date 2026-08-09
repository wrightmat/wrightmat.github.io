// Data loading for Sanctum's reference kinds — location-type, location-purpose,
// feature (category "location"), resource, species (for the optional NPC
// Generation Config section) — plus Setting/Location themselves, all managed
// generically via fetchKindEntriesWithIds (common/js/lib/content-fetch.js), the
// authenticated-aware list-then-fetch-each helper every other tool already uses.
// Sanctum is now the sole authoring surface for setting/location (Loom's old
// Places panel is retired), so every read here must see the signed-in user's own
// private/unpublished records, not just public ones — dataManager-backed throughout.
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

// `settingIds` is a plural array (same "empty/absent = universal, non-empty =
// restricted" convention as systemIds) — but unlike a Resource's optional
// scoping, a Location with an EMPTY settingIds genuinely belongs to no
// Setting yet (there's no "universal Location"), so this deliberately checks
// `includes` only, not the empty-array-matches-everything shortcut
// matchesSetting (generator.js) uses for Resources. Falls back to a
// pre-migration scalar `settingId` for any not-yet-resaved record — same
// precedent as the `system` → `systemIds` character migration.
export async function listLocationsForSetting(dataManager, settingId) {
  if (!settingId) return [];
  const entries = await fetchKindEntriesWithIds(dataManager, "location");
  return entries
    .filter((entry) => {
      const ids = Array.isArray(entry.entity.settingIds) ? entry.entity.settingIds : entry.entity.settingId ? [entry.entity.settingId] : [];
      return ids.includes(settingId);
    })
    .map((entry) => ({ id: entry.id, ...entry.entity }));
}
