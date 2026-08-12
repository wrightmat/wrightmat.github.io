// Shared "read a System's own Rarity price ranges" helper — for the
// Dashboard's Item Price calculator (calculator-modes counterpart of
// combat-scaling.js, which this file otherwise mirrors exactly).
//
// priceMin/priceMax are ordinary extra properties on the same Rarity values
// Vault already reads for its own budgetCost/targetBudget (sys.dnd5e.json's
// "rarity" field) — not a new column in Loom's Property editor (every value
// row already round-trips unlisted keys through its own "Extra JSON"
// catch-all, per property-schema-editor.js's own `data-value-extra` box), so
// authoring these needs no UI change, just data.
//
// Which field supplies this data is the same tool preference Vault's own
// Budget ceiling field setting already resolves (vault/js/app.js's
// budgetCeilingField, bucket "vault-settings") — a System without magic-item
// rarity at all (most non-D&D Systems) simply has no such field, and this
// resolves to an empty list rather than an error, same as
// loadCombatScalingLevels for a System with no Combat Scaling data.
export function slugify(name) {
  return String(name || "")
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/(^-|-$)/g, "");
}

function hasPriceRange(value) {
  return typeof value?.priceMin === "number" && typeof value?.priceMax === "number";
}

export async function loadRarityPriceRanges(dataManager, systemId, rarityField = "rarity") {
  if (!dataManager || !systemId || !rarityField) return [];
  try {
    // preferLocal: false — a Loom edit to the System's fields must be
    // visible immediately, not hidden behind a stale local cache. Same
    // reasoning as combat-scaling.js's own System read.
    const result = await dataManager.get("systems", systemId, { preferLocal: false });
    const fields = Array.isArray(result?.payload?.fields) ? result.payload.fields : [];
    const field = fields.find((entry) => entry.type === "array" && entry.key === rarityField);
    if (!field) return [];
    return (field.values || [])
      .filter(hasPriceRange)
      .map((value, index) => ({
        id: value.id || slugify(value.name) || `rarity-${index}`,
        name: value.name || value.label || String(value.id || index),
        priceMin: value.priceMin,
        priceMax: value.priceMax,
      }));
  } catch (error) {
    return [];
  }
}

// Qualitative tiers for the optional "how did the PC's check go" modifier.
// This deliberately doesn't know or enforce any particular DC — tables set
// their own DC for whatever check they use (Persuasion when haggling,
// Insight/an appraisal-flavored check when assessing a find, ...); the GM
// just compares the roll to their own DC and picks the matching tier here.
//
// buyMultiplier/sellMultiplier apply directly to the rolled base price (see
// rollItemPrices below) — not a percentile shift within the range, which
// (an earlier version of this) turned out to barely move the result and, for
// selling specifically, capped it at half the rolled price no matter how
// good the check was (half of even the top of the range still often landed
// below the tier's own priceMin). Multipliers fix both: a great check can
// push a sale close to full rolled price (extreme-success sellMultiplier
// 0.9), and a bad one can push a purchase above the rolled price entirely
// (extreme-failure buyMultiplier 1.3) — deliberately allowed to land outside
// [priceMin, priceMax] at the extremes, since overpaying above "list price"
// or underselling below the tier's usual floor is exactly what a genuinely
// extreme result should feel like, not something to clamp away.
export const PRICE_CHECK_TIERS = [
  { id: "extreme-failure", label: "Extreme failure", buyMultiplier: 1.3, sellMultiplier: 0.15 },
  { id: "fail", label: "Failed", buyMultiplier: 1.1, sellMultiplier: 0.3 },
  { id: "none", label: "No check rolled", buyMultiplier: 1, sellMultiplier: 0.5 },
  { id: "succeed", label: "Succeeded", buyMultiplier: 0.85, sellMultiplier: 0.7 },
  { id: "extreme-success", label: "Extreme success", buyMultiplier: 0.65, sellMultiplier: 0.9 },
];

// A Bates(3) distribution (the mean of 3 uniform rolls) instead of a flat
// Math.random() — clusters results toward the middle of the range so a roll
// doesn't swing to either extreme as often as a uniform pick would, the same
// "feels more like a real price" shape 3d6 has over 1d20.
function rollBasePercentile(random) {
  return (random() + random() + random()) / 3;
}

function percentileToPrice(percentile, priceMin, priceMax) {
  const clamped = Math.min(1, Math.max(0, percentile));
  const raw = priceMin + clamped * (priceMax - priceMin);
  const rounded = Math.round(raw / 5) * 5;
  return Math.min(priceMax, Math.max(priceMin, rounded));
}

// Rolls ONE base price within [priceMin, priceMax] (the item's rolled
// "sticker price," unaffected by the check), then applies the check tier's
// buy/sell multiplier to it — see PRICE_CHECK_TIERS above for why a
// multiplier, not a shifted re-roll. A single base roll drives both figures,
// so picking a tier once covers whichever of the two actually applies to
// this transaction without the GM having to say which in advance.
export function rollItemPrices(priceMin, priceMax, { checkTierId = "none", random = Math.random } = {}) {
  const tier = PRICE_CHECK_TIERS.find((entry) => entry.id === checkTierId) || PRICE_CHECK_TIERS.find((entry) => entry.id === "none");
  const basePrice = percentileToPrice(rollBasePercentile(random), priceMin, priceMax);
  const buyPrice = Math.max(0, Math.round((basePrice * tier.buyMultiplier) / 5) * 5);
  const sellPrice = Math.max(0, Math.round((basePrice * tier.sellMultiplier) / 5) * 5);
  return { buyPrice, sellPrice };
}
