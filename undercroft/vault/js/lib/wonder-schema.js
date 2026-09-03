function randomId() {
  if (typeof crypto !== "undefined" && typeof crypto.randomUUID === "function") {
    return crypto.randomUUID();
  }
  return `${Math.random().toString(16).slice(2)}-${Date.now()}`;
}

// Stamps a freshly generated wonder with an id + timestamp — separate from
// generateWonder so authoring-mode edits (reusing an existing record) don't
// get a new id/createdAt each time. Mirrors Crucible's monster-schema.js.
export function createWonderRecord(generated) {
  return {
    id: `won_${randomId()}`,
    ...generated,
    createdAt: new Date().toISOString(),
  };
}

// Already Press-compatible (flat, JSON-serializable) — kept as its own
// function (mirrors Crucible's toPressExportShape) so a future GM-only
// field has an obvious exclusion point.
export function toPressExportShape(record) {
  return { ...record };
}
