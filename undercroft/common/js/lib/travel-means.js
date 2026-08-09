// A System's own travel means (walking pace, horseback, an Eberron airship,
// ...) are not hardcoded here or in any widget — they're an ordinary
// Enum-mode Array property with the reserved key "travelMeans", the exact
// same "just another array field, discovered by a fixed marker" convention
// this session's own dice.js's dice/rolls fields already established (see
// that file's own comment for the full reasoning) — nothing new for Loom's
// array editor to support, a GM authors these with the array editor that
// already exists.
//
// Each value's `name` is both its id and display label (same as every other
// Enum value in the suite). `speedMph`/`hoursPerDay`/`fare` live in that
// value's own Extra properties (JSON) catch-all — exactly like a die's
// `sides`/`color`/`faceMap` do. `settingIds` on a value is the SAME
// convention `common/data/resource/*.json` entries use (see
// code-conventions.md's "Resource conventions") applied at the per-value
// level instead of the whole-record level, since a System can define travel
// means that only make sense in one of its Settings (Eberron's Lightning
// Rail) alongside means that apply everywhere it's used (On Foot).
export function extractSystemTravelMeans(systemDefinition, settingId = null) {
  const fields = Array.isArray(systemDefinition?.fields) ? systemDefinition.fields : [];
  const field = fields.find((entry) => entry?.type === "array" && entry.key === "travelMeans");
  const values = Array.isArray(field?.values) ? field.values : [];
  return values
    .filter((value) => value && typeof value.name === "string" && value.name)
    .filter((value) => matchesTravelMeansSetting(value, settingId))
    .map((value) => ({
      id: value.name,
      label: value.name,
      speedMph: typeof value.speedMph === "number" ? value.speedMph : 0,
      hoursPerDay: typeof value.hoursPerDay === "number" ? value.hoursPerDay : 8,
      fare: value.fare && typeof value.fare === "object" ? value.fare : null,
    }));
}

// Same "empty/absent = universal, non-empty = restricted" convention as
// Resource's own settingIds (matchesSetting, sanctum/js/lib/generator.js) —
// a travel means with no settingIds is available under any Setting; one
// with settingIds only shows up when that specific Setting is active.
function matchesTravelMeansSetting(value, settingId) {
  if (!settingId) return true;
  const ids = Array.isArray(value.settingIds) ? value.settingIds : [];
  return !ids.length || ids.includes(settingId);
}

// A `fare` entry is `{ amount, unit, perMiles }` (e.g. Lightning Rail First
// Class: 6 sp per 15 miles) — this computes the total cost in COPPER pieces
// (the finest denomination any fare uses, so every result is a whole
// number) for a given distance, letting a caller format/convert to
// gp/sp/cp display units however it prefers. Returns 0 for a missing entry
// (a free/unpriced means, e.g. On Foot) rather than throwing, since "no
// fare" is a normal, expected case here, not an error.
const COPPER_PER_UNIT = { cp: 1, sp: 10, gp: 100, pp: 1000 };

export function computeFareCopper(fareEntry, miles) {
  if (!fareEntry || typeof fareEntry.amount !== "number" || !fareEntry.perMiles) {
    return 0;
  }
  const perUnit = COPPER_PER_UNIT[fareEntry.unit] || 1;
  return Math.ceil((fareEntry.amount * perUnit * miles) / fareEntry.perMiles);
}

// Formats a copper total back into the largest denominations it cleanly
// breaks into (gp/sp/cp) for display — the inverse of computeFareCopper's
// own conversion. "0 cp" for a free trip, never an empty string.
export function formatCopperAsCurrency(copper) {
  if (!copper) return "0 cp";
  const gp = Math.floor(copper / 100);
  const sp = Math.floor((copper % 100) / 10);
  const cp = copper % 10;
  const parts = [];
  if (gp) parts.push(`${gp} gp`);
  if (sp) parts.push(`${sp} sp`);
  if (cp || !parts.length) parts.push(`${cp} cp`);
  return parts.join(", ");
}
