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
    typeId: null,
    purposeId: null,
    environment: null,
    featureIds: [],
    assets: [],
    needs: [],
    parentId: null,
    connectedTo: [],
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
