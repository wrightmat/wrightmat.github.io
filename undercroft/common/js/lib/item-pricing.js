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
import { rollDiceExpression } from "../../../workbench/js/lib/dice.js";

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
function resolveCheckTier(checkTierId) {
  return PRICE_CHECK_TIERS.find((entry) => entry.id === checkTierId) || PRICE_CHECK_TIERS.find((entry) => entry.id === "none");
}

// Nearest-5 reads as a "real price" for anything sizable (a rarity-rolled
// magic item, typically tens to thousands of gp — a 5-unit granularity is
// well under 1% of a typical roll there) — but that same granularity is
// FAR too coarse below roughly 20: it doesn't just erase a small price
// (an ordinary 2gp Backpack rounds to 0) but actively distorts one close
// to a multiple of 5 (a 5gp Handaxe at the "none" tier's own 50% sell
// discount is 2.5gp — nearest-5 rounds that UP to 5, wiping out the
// discount entirely by coincidence of where 2.5 happens to fall, not a
// missing-price edge case at all). Confirmed real, reported bug both
// times.
//
// Below the threshold, a further "round to the nearest whole unit" turned
// out to be its OWN version of the exact same mistake — 2.5gp isn't an
// imprecise result to snap to 2 or 3, it's a perfectly real price (2gp,
// 5sp — the user's own "someone could drop 100 pennies on the counter"
// framing applies here too). So below the threshold this only rounds off
// float noise (to the nearest hundredth), keeping any real fractional
// value intact for currency.js's own base-unit conversion to break back
// down into actual coins for display/payment — never collapsing it to a
// whole number in whatever single denomination the price happens to be
// quoted in.
const SMALL_PRICE_ROUNDING_THRESHOLD = 20;
export function roundPrice(raw) {
  if (raw <= 0) return 0;
  if (raw < SMALL_PRICE_ROUNDING_THRESHOLD) return Math.round(raw * 100) / 100;
  return Math.round(raw / 5) * 5;
}

// Shared by rollItemPrices and rollResourcePrice below — same "one rolled
// base price drives both buy and sell" split from PRICE_CHECK_TIERS' own
// multipliers, regardless of how that base price was actually derived (a
// rarity range's own percentile roll vs. a Resource's own dice-expression
// roll) — one place for this math, not two copies that could drift apart.
function applyCheckTier(basePrice, checkTierId) {
  const tier = resolveCheckTier(checkTierId);
  return { buyPrice: roundPrice(basePrice * tier.buyMultiplier), sellPrice: roundPrice(basePrice * tier.sellMultiplier) };
}

export function rollItemPrices(priceMin, priceMax, { checkTierId = "none", random = Math.random } = {}) {
  const basePrice = percentileToPrice(rollBasePercentile(random), priceMin, priceMax);
  return applyCheckTier(basePrice, checkTierId);
}

// A Resource's own "3d4x125 gp"-style freeform price string (the same
// documented freeform-JSON convention Vault/Sanctum already read `price`
// as — see undercroft/README.md's Code Conventions section), NOT any
// standard dice-expression grammar on its own: "x" is this suite's own
// tabletop-shorthand multiply (converted to "*" for rollDiceExpression's
// own grammar below), and a trailing coin denomination is required. Returns
// null for anything that doesn't end in one of the five standard coin
// abbreviations — a price that isn't even freeform-rollable (blank, prose
// like "priceless") has nothing here to price a shop item from.
const PRICE_EXPRESSION_PATTERN = /^(.*?)\s*(cp|sp|ep|gp|pp)$/i;
export function parsePriceExpression(text) {
  const match = PRICE_EXPRESSION_PATTERN.exec(String(text || "").trim());
  if (!match) return null;
  const expression = match[1].replace(/(\d)\s*[xX]\s*(\d)/g, "$1*$2").trim();
  if (!expression) return null;
  return { expression, denomination: match[2].toLowerCase() };
}

// The Rarity-range tier's own sibling for anything with no rarity to roll
// against at all — a Resource's own freeform price string above, rolled
// ONCE for a "base price" the exact same way rollItemPrices rolls one from
// [priceMin, priceMax], then run through the identical PRICE_CHECK_TIERS
// multiplier (applyCheckTier) so both pricing paths behave identically from
// a GM's/Shop's own point of view (same buy-higher/sell-lower split, same
// "PC's check" lever) — only how the base price is actually derived
// differs. Returns null (not thrown) for anything parsePriceExpression or
// rollDiceExpression itself can't handle — an unpriceable Resource is
// simply not stocked, same as an unpriced Wonder today (shop-
// transactions.js's own priceAsset).
export function rollResourcePrice(priceExpression, { checkTierId = "none", random = Math.random } = {}) {
  const parsed = parsePriceExpression(priceExpression);
  if (!parsed) return null;
  let basePrice;
  try {
    basePrice = rollDiceExpression(parsed.expression, { random }).total;
  } catch (error) {
    return null;
  }
  if (!Number.isFinite(basePrice) || basePrice < 0) return null;
  return { ...applyCheckTier(basePrice, checkTierId), denomination: parsed.denomination };
}
