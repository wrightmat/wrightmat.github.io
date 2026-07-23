function randomId() {
  if (typeof crypto !== "undefined" && typeof crypto.randomUUID === "function") {
    return crypto.randomUUID();
  }
  return `${Math.random().toString(16).slice(2)}-${Date.now()}`;
}

// Stamps a freshly generated monster (from generator.js) with an id +
// timestamp so it's ready to save — kept separate from generateMonster
// itself so rerolls (which reuse an existing record) don't get a new
// id/createdAt each time, same reasoning as Forge's npc-schema.js.
export function createMonsterRecord(generated) {
  return {
    id: `mon_${randomId()}`,
    ...generated,
    createdAt: new Date().toISOString(),
  };
}

// The saved monster record is already Press-compatible (flat, JSON-
// serializable) — nothing to strip today, but kept as its own function
// (mirroring Forge's toPressExportShape) so a future GM-facing-only field
// (e.g. a resolution-audit trail analogous to Forge's `rolls`) has an
// obvious place to be excluded from exports without touching every call site.
export function toPressExportShape(record) {
  return { ...record };
}
