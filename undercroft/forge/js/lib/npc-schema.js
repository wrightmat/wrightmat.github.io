function randomId() {
  if (typeof crypto !== "undefined" && typeof crypto.randomUUID === "function") {
    return crypto.randomUUID();
  }
  return `${Math.random().toString(16).slice(2)}-${Date.now()}`;
}

// Separate from generateNpc so a reroll (which reuses an existing record)
// doesn't get a new id/createdAt each time.
export function createNpcRecord(generated) {
  return {
    id: `npc_${randomId()}`,
    ...generated,
    createdAt: new Date().toISOString(),
  };
}

// The saved/exported NPC record IS the Press-compatible shape already
// (identity + fourD + note, flat and JSON-serializable) — this just strips
// the GM-facing roll-audit detail that Press has no use for.
export function toPressExportShape(record) {
  const { rolls, ...exportable } = record;
  return exportable;
}
