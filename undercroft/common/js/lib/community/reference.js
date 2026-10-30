// Community reference data: the static JSON under common/data/community and
// common/data/geo, plus the Library Systems a profile or listing can name.
// Fetched on demand and cached for the page; the admin-edited lists can be
// re-read with invalidateCommunityReference() after a save.

const DATA_ROOT = new URL("../../../data/", import.meta.url);
let referencePromise = null;
const geoCache = new Map();

async function fetchJson(path, { optional = false } = {}) {
  const response = await fetch(new URL(path, DATA_ROOT), { cache: "no-store" });
  if (!response.ok) {
    if (optional) return null;
    throw new Error(`Could not load ${path}`);
  }
  return response.json();
}

// One of the community-defined lists as stored: { fonts: [...] } etc.
export async function loadSharedList(file, key) {
  const data = await fetchJson(file);
  return Array.isArray(data?.[key]) ? data[key] : [];
}

export function invalidateCommunityReference() {
  referencePromise = null;
}

// { scales, points, options, safetyTools, endorsements, services }
export function loadCommunityReference() {
  if (!referencePromise) {
    referencePromise = Promise.all([
      fetchJson("community-scales.json"),
      fetchJson("community-options.json"),
      fetchJson("community-safety-tools.json"),
      fetchJson("community-endorsements.json"),
      fetchJson("community-services.json"),
    ]).then(([scales, options, safetyTools, endorsements, services]) => ({
      scales: scales.scales,
      points: scales.points,
      options,
      safetyTools: safetyTools.items || [],
      endorsements: endorsements.items || [],
      services: services.items || [],
    }));
    referencePromise.catch(() => {
      referencePromise = null;
    });
  }
  return referencePromise;
}

function cachedGeo(path) {
  if (!geoCache.has(path)) {
    geoCache.set(
      path,
      fetchJson(path, { optional: true }).catch((error) => {
        geoCache.delete(path);
        throw error;
      }),
    );
  }
  return geoCache.get(path);
}

export function loadCountries() {
  return cachedGeo("geo-countries.json").then((list) => list || []);
}

export function loadRegions(countryCode) {
  return countryCode ? cachedGeo("geo-regions.json").then((byCountry) => (byCountry || {})[countryCode] || []) : Promise.resolve([]);
}

// { "606": "Chicago, IL", ... }
export function loadUsAreas() {
  return cachedGeo("geo-us-areas.json").then((map) => map || {});
}

export function optionLabel(options, group, id) {
  const found = (options?.[group] || []).find((entry) => entry.id === id);
  return found ? found.label : id || "";
}

// The Library Systems visible to this user, as [{ id, title }].
export async function loadSystemChoices(dataManager) {
  try {
    const listing = await dataManager.list("system", { refresh: false });
    return dataManager
      .collectListEntries(listing.remote, ["owned", "shared", "public", "items"])
      .map((entry) => ({ id: entry.id, title: entry.title || entry.name || entry.id }))
      .sort((a, b) => a.title.localeCompare(b.title));
  } catch (error) {
    return [];
  }
}

export function systemTitle(systems, id) {
  return systems.find((entry) => entry.id === id)?.title || id || "";
}
