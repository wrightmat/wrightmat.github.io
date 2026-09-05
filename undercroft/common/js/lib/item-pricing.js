// Shared "read a System's own Rarity price ranges" helper for the
// Dashboard's Item Price calculator — mirrors combat-scaling.js's own
// pattern. priceMin/priceMax are ordinary extra properties on the same
// Rarity values Vault reads for cost, round-tripped
// through property-schema-editor.js's Extra JSON catch-all, so authoring
// needs no UI change. Which field supplies this data is the same tool
// preference Vault's Budget ceiling field setting resolves; a System with no
// such field resolves to an empty list rather than an error.
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
    // preferLocal: false — a Loom edit must be visible immediately, not
    // hidden behind a stale local cache (same as combat-scaling.js).
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
// Deliberately doesn't enforce any particular DC — the GM sets their own for
// whatever check applies (Persuasion, an appraisal check, ...) and picks the
// matching tier here.
//
// buyMultiplier/sellMultiplier apply directly to the rolled base price, not
// a percentile shift within the range — a shift barely moved the result and
// capped a sale at half the rolled price regardless of how good the check
// was. Multipliers are deliberately allowed to land outside [priceMin,
// priceMax] at the extremes: overpaying above list price or underselling
// below the usual floor is what an extreme result should feel like.
export const PRICE_CHECK_TIERS = [
  { id: "extreme-failure", label: "Extreme failure", buyMultiplier: 1.3, sellMultiplier: 0.15 },
  { id: "fail", label: "Failed", buyMultiplier: 1.1, sellMultiplier: 0.3 },
  { id: "none", label: "No check rolled", buyMultiplier: 1, sellMultiplier: 0.5 },
  { id: "succeed", label: "Succeeded", buyMultiplier: 0.85, sellMultiplier: 0.7 },
  { id: "extreme-success", label: "Extreme success", buyMultiplier: 0.65, sellMultiplier: 0.9 },
];

// A Bates(3) distribution (mean of 3 uniform rolls), not a flat
// Math.random() — clusters toward the middle so results don't swing to
// either extreme as often, the same "feels more real" shape 3d6 has over 1d20.
function rollBasePercentile(random) {
  return (random() + random() + random()) / 3;
}

function percentileToPrice(percentile, priceMin, priceMax) {
  const clamped = Math.min(1, Math.max(0, percentile));
  const raw = priceMin + clamped * (priceMax - priceMin);
  const rounded = Math.round(raw / 5) * 5;
  return Math.min(priceMax, Math.max(priceMin, rounded));
}

// A single base roll drives both buy and sell figures, so picking a tier
// once covers whichever actually applies without the GM saying which first.
function resolveCheckTier(checkTierId) {
  return PRICE_CHECK_TIERS.find((entry) => entry.id === checkTierId) || PRICE_CHECK_TIERS.find((entry) => entry.id === "none");
}

// Nearest-5 is fine for sizable prices (tens to thousands of gp), but too
// coarse below ~20: it erases a 2gp price entirely (rounds to 0) and
// distorts a 2.5gp discounted price up to 5, silently wiping it out. Below
// the threshold this only rounds off float noise (to the nearest hundredth)
// instead, keeping real fractional values (2gp, 5sp) intact for
// currency.js's own coin breakdown rather than collapsing to a whole unit.
const SMALL_PRICE_ROUNDING_THRESHOLD = 20;
export function roundPrice(raw) {
  if (raw <= 0) return 0;
  if (raw < SMALL_PRICE_ROUNDING_THRESHOLD) return Math.round(raw * 100) / 100;
  return Math.round(raw / 5) * 5;
}

// Shared by rollItemPrices and rollResourcePrice — one place for the
// base-price -> buy/sell split regardless of how the base price was derived.
function applyCheckTier(basePrice, checkTierId) {
  const tier = resolveCheckTier(checkTierId);
  return { buyPrice: roundPrice(basePrice * tier.buyMultiplier), sellPrice: roundPrice(basePrice * tier.sellMultiplier) };
}

export function rollItemPrices(priceMin, priceMax, { checkTierId = "none", random = Math.random } = {}) {
  const basePrice = percentileToPrice(rollBasePercentile(random), priceMin, priceMax);
  return applyCheckTier(basePrice, checkTierId);
}

// A Resource's own "3d4x125 gp"-style freeform price string (same
// freeform-JSON convention Vault/Sanctum read `price` as). "x" is this
// suite's tabletop-shorthand multiply, converted to "*" for
// rollDiceExpression's grammar; a trailing coin denomination is required.
// Returns null for anything that isn't rollable (blank, "priceless").
const PRICE_EXPRESSION_PATTERN = /^(.*?)\s*(cp|sp|ep|gp|pp)$/i;
export function parsePriceExpression(text) {
  const match = PRICE_EXPRESSION_PATTERN.exec(String(text || "").trim());
  if (!match) return null;
  const expression = match[1].replace(/(\d)\s*[xX]\s*(\d)/g, "$1*$2").trim();
  if (!expression) return null;
  return { expression, denomination: match[2].toLowerCase() };
}

// Rarity-range pricing's sibling for anything with no rarity at all: rolls
// the Resource's freeform price string once for a base price, then runs it
// through the same applyCheckTier so both paths behave identically to a
// GM/Shop. Returns null (not thrown) for anything unparseable — an
// unpriceable Resource is simply not stocked (see shop-transactions.js's
// priceAsset).
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
