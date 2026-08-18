function randomId() {
  if (typeof crypto !== "undefined" && typeof crypto.randomUUID === "function") {
    return crypto.randomUUID();
  }
  return `${Math.random().toString(16).slice(2)}-${Date.now()}`;
}

// Stamps a freshly generated location (from generator.js) with an id + name only
// when it's actually new — mirrors Crucible's/Vault's createXRecord, but Sanctum's
// Location kind already has real, human-chosen slug ids in the wild (e.g. "sharn",
// "sword-coast"), so this only ever invents a `loc_<uuid>` id for a location that
// didn't already have one; loading and re-saving an existing record (including those
// hand-authored ones) always preserves its original id.
export function createLocationRecord(generated, existingId) {
  return {
    kind: "location",
    name: "",
    // Defensive defaults — `generated` may be an existing record loaded straight
    // from storage (e.g. one Forge/Loom authored before Sanctum's fields existed),
    // not always a fresh generator.js output, so every Sanctum-owned array/scalar
    // needs a safe fallback rather than assuming it's always present.
    systemIds: [],
    // Plural, same "empty/absent = universal, non-empty = restricted"
    // convention as systemIds — a Location could in principle belong to more
    // than one Setting (a place reachable from two different worlds). A
    // pre-migration record may still carry the old scalar `settingId`;
    // callers normalize that on read (see `listLocationsForSetting` in
    // common/js/lib/content-fetch.js) rather than this schema silently
    // upgrading it, so a loaded-but-unsaved record doesn't look dirty just
    // from being viewed.
    settingIds: [],
    typeId: null,
    purposeId: null,
    environment: null,
    featureIds: [],
    assets: [],
    needs: [],
    // Containment (was `parentId`) and adjacency (was `connectedTo`) are no
    // longer fields on the Location record itself — both are now just
    // `relationship` records ("Parent of"/"Connected to" types), the same
    // suite-wide graph every other kind uses (common/js/lib/
    // relationship-graph.js). A record loaded from before this change may
    // still carry these keys in its raw JSON; nothing in this tool reads
    // them anymore (see reloadLocationsForSetting's own migration step,
    // sanctum/js/app.js), so they're harmless leftover data, never
    // reintroduced by this schema going forward.
    notes: "",
    ...generated,
    id: existingId || `loc_${randomId()}`,
  };
}

// The saved location record is already Press-compatible (flat, JSON-serializable) —
// kept as its own function (mirroring Crucible's/Vault's toPressExportShape) so a
// future GM-facing-only field has an obvious place to be excluded from exports
// without touching every call site.
export function toPressExportShape(record) {
  return { ...record };
}
