function randomId() {
  if (typeof crypto !== "undefined" && typeof crypto.randomUUID === "function") {
    return crypto.randomUUID();
  }
  return `${Math.random().toString(16).slice(2)}-${Date.now()}`;
}

// Stamps a freshly generated location with an id, mirroring Crucible's/Vault's
// createXRecord — except Sanctum's Location kind already has real, human-chosen
// slug ids in the wild (e.g. "sharn"), so this only invents a `loc_<uuid>` id
// for a location that didn't already have one; re-saving preserves the original.
export function createLocationRecord(generated, existingId) {
  return {
    kind: "location",
    name: "",
    // Defaults guard against `generated` being an existing record loaded from
    // storage (authored before Sanctum's fields existed), not always fresh
    // generator.js output.
    systemIds: [],
    // Plural, same "empty/absent = universal" convention as systemIds — a
    // Location could belong to more than one Setting. A pre-migration record
    // may still carry the old scalar `settingId`; callers normalize that on
    // read (listLocationsForSetting, content-fetch.js), not this schema.
    settingIds: [],
    typeId: null,
    purposeId: null,
    environment: null,
    featureIds: [],
    assets: [],
    needs: [],
    // Containment/adjacency aren't Location fields — they're `relationship`
    // records (the suite-wide graph, relationship-graph.js). An old record
    // may still carry leftover `parentId`/`connectedTo` keys; unread, harmless.
    notes: "",
    ...generated,
    id: existingId || `loc_${randomId()}`,
  };
}

// Already Press-compatible (flat, JSON-serializable) — kept as its own
// function (mirrors Crucible's/Vault's toPressExportShape) so a future
// GM-only field has an obvious exclusion point.
export function toPressExportShape(record) {
  return { ...record };
}
