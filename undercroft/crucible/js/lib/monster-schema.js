function randomId() {
  if (typeof crypto !== "undefined" && typeof crypto.randomUUID === "function") {
    return crypto.randomUUID();
  }
  return `${Math.random().toString(16).slice(2)}-${Date.now()}`;
}

// Separate from generateMonster so a reroll (which reuses an existing
// record) doesn't get a new id/createdAt each time.
export function createMonsterRecord(generated) {
  return {
    id: `mon_${randomId()}`,
    ...generated,
    createdAt: new Date().toISOString(),
  };
}

// Nothing to strip today — kept as its own function so a future GM-only
// field has one place to be excluded from exports.
export function toPressExportShape(record) {
  return { ...record };
}
