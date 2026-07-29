// Auto-numbering for duplicate combatant names ("Goblin" + "Goblin" ->
// "Goblin 1" + "Goblin 2") — a single shared helper so every way of adding a
// combatant (Combat Tracker's own one-at-a-time "Add Combatant" box, and
// Repository's bulk `encounter:` block builder) gets identical behavior
// instead of each maintaining its own copy.
//
// Combatant name is a single, directly-editable `combatant.name` field (see
// combat-tracker.js's renderCombatantEditPanel) — there's no separate "base
// name" stored anywhere. Numbering is therefore baked into the stored name
// at add-time, not computed at render time, so every row (and the edit
// panel's own Name field) always agree, and a GM can still freely rename
// afterward same as today.

function escapeRegExp(value) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

// `name` is the freshly-typed/resolved name for a combatant about to be
// added; `existingCombatants` is the encounter's current combatants array
// (checked BEFORE the new one is pushed). Returns the name to actually store
// for the new combatant — unchanged if nothing else shares it, otherwise the
// next number in the sequence, after renaming the one still-unnumbered
// pre-existing sibling (if any) to "<name> 1" in place.
//
// Matches `name` exactly, or `name` followed by " <number>" — anchored, so a
// real creature name that happens to already contain digits elsewhere (e.g.
// "Type-7 Sentinel") is never mistaken for an auto-numbered sibling.
export function uniquifyCombatantName(name, existingCombatants) {
  const base = String(name || "").trim();
  if (!base) return base;
  const familyPattern = new RegExp(`^${escapeRegExp(base)}(?: (\\d+))?$`, "i");
  const family = (existingCombatants || []).filter((combatant) => familyPattern.test(String(combatant.name || "").trim()));
  if (!family.length) return base;
  const unnumbered = family.find((combatant) => !/\s\d+$/.test(String(combatant.name || "").trim()));
  if (unnumbered) unnumbered.name = `${base} 1`;
  const usedNumbers = family
    .map((combatant) => {
      const match = /\s(\d+)$/.exec(String(combatant.name || "").trim());
      return match ? Number(match[1]) : null;
    })
    .filter((n) => n !== null);
  const nextNumber = usedNumbers.length ? Math.max(...usedNumbers) + 1 : 2;
  return `${base} ${nextNumber}`;
}
