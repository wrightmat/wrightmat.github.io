// A System's own travel means (walking pace, horseback, an Eberron airship,
// ...) are an ordinary Enum-mode Array property with the reserved key
// "travelMeans" — same reserved-key convention as `dice`/`rolls`, nothing
// new for Loom's array editor.
//
// Each value's `name` is both id and display label. `speedMph`/
// `hoursPerDay`/`fare` live in that value's Extra properties (JSON)
// catch-all. `settingIds` follows the same "restrict to one Setting"
// convention `common/data/resource/*.json` uses, applied per-value instead
// of per-record, since some means only make sense in one Setting (Eberron's
// Lightning Rail) while others apply everywhere (On Foot).
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

// Empty/absent settingIds = available under any Setting (matches
// Resource's own matchesSetting convention, sanctum/js/lib/generator.js).
function matchesTravelMeansSetting(value, settingId) {
  if (!settingId) return true;
  const ids = Array.isArray(value.settingIds) ? value.settingIds : [];
  return !ids.length || ids.includes(settingId);
}

// `fare` is `{amount, unit, perMiles}` (e.g. Lightning Rail First Class: 6 sp
// per 15 miles). Computes total cost in copper (finest denomination, so the
// result is always a whole number); returns 0 for a missing/free entry
// (On Foot) rather than throwing.
const COPPER_PER_UNIT = { cp: 1, sp: 10, gp: 100, pp: 1000 };

export function computeFareCopper(fareEntry, miles) {
  if (!fareEntry || typeof fareEntry.amount !== "number" || !fareEntry.perMiles) {
    return 0;
  }
  const perUnit = COPPER_PER_UNIT[fareEntry.unit] || 1;
  return Math.ceil((fareEntry.amount * perUnit * miles) / fareEntry.perMiles);
}

// Inverse of computeFareCopper — breaks a copper total into gp/sp/cp for
// display. "0 cp" for a free trip, never an empty string.
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
