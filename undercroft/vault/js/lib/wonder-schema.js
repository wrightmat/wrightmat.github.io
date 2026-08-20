function randomId() {
  if (typeof crypto !== "undefined" && typeof crypto.randomUUID === "function") {
    return crypto.randomUUID();
  }
  return `${Math.random().toString(16).slice(2)}-${Date.now()}`;
}

// Stamps a freshly generated wonder (from generator.js) with an id +
// timestamp so it's ready to save — kept separate from generateWonder itself
// so authoring-mode edits (which reuse an existing record) don't get a new
// id/createdAt each time, mirroring Crucible's monster-schema.js.
export function createWonderRecord(generated) {
  return {
    id: `won_${randomId()}`,
    ...generated,
    createdAt: new Date().toISOString(),
  };
}

// The saved wonder record is already Press-compatible (flat, JSON-
// serializable) — kept as its own function (mirroring Crucible's
// toPressExportShape) so a future GM-facing-only field has an obvious place
// to be excluded from exports without touching every call site.
export function toPressExportShape(record) {
  return { ...record };
}
