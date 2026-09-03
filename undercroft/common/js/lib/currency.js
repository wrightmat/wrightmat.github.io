// Shared, System-agnostic currency conversion — "how much is this ACTUALLY
// worth, and can it be paid regardless of which specific coins someone is
// holding." A System's own denominations live as an ordinary Enum-mode
// Array property with the reserved key "currency" — each value's `cost` is
// its worth in the SMALLEST denomination the System defines (sys.dnd5e.json:
// Copper 1, Silver 10, Electrum 50, Gold 100, Platinum 1000). Never
// hardcoded here — travel-means.js's own COPPER_PER_UNIT table is the
// cautionary example this avoids repeating (fixed to cp/sp/gp/pp, missing
// Electrum, unusable for a non-D&D System's denominations).
//
// The core idea, matching how real money works: affordability and payment
// are never about matching ONE specific denomination — they're about TOTAL
// VALUE. Convert everything to the smallest unit for comparison/arithmetic,
// then convert back to the largest denominations that cleanly cover the
// result for display, like a cashier making change.

export function loadCurrencyDenominations(systemDefinition) {
  const fields = Array.isArray(systemDefinition?.fields) ? systemDefinition.fields : [];
  const field = fields.find((entry) => entry?.type === "array" && entry.key === "currency");
  const values = Array.isArray(field?.values) ? field.values : [];
  return values.filter((value) => value?.shortName && Number.isFinite(value.cost) && value.cost > 0);
}

export async function loadSystemCurrencyDenominations(dataManager, systemId) {
  if (!dataManager || !systemId) return [];
  try {
    const result = await dataManager.get("systems", systemId, { preferLocal: false });
    return loadCurrencyDenominations(result?.payload);
  } catch (error) {
    return [];
  }
}

// A {[shortName]: amount} purse (a Character's own `currencies`, or the
// party wallet's identical shape) -> its total worth in the System's own
// smallest denomination. A System with no "currency" field at all (hasn't
// opted in) can't meaningfully convert anything — returns 0 rather than
// guessing, same as every other generator-property reader in this suite
// degrades when its own field is absent.
export function currencyToBaseUnits(currency, denominations) {
  if (!currency || !Array.isArray(denominations) || !denominations.length) return 0;
  return denominations.reduce((total, denom) => total + (Number(currency[denom.shortName]) || 0) * denom.cost, 0);
}

// The inverse — breaks a base-unit total back into the FEWEST coins
// (largest denominations first), e.g. 250 base units on sys.dnd5e ->
// {gp: 2, sp: 5}. Returns a plain {[shortName]: amount} object with only
// nonzero denominations set. Any remainder smaller than the smallest
// denomination's cost lands on that smallest denomination rather than
// silently vanishing.
export function baseUnitsToCurrency(totalBaseUnits, denominations) {
  const result = {};
  if (!Array.isArray(denominations) || !denominations.length) return result;
  let remaining = Math.max(0, Math.round(totalBaseUnits));
  // Fills in the denominations' OWN authored order (the System's Currency
  // field order), not sorted by cost — a GM lists denominations in the
  // order they actually want change made in, and an in-between
  // denomination nobody uses (D&D's Electrum, sitting between sp and gp)
  // shouldn't get silently preferred just because it falls in that value
  // range (250 base units broke down as "2gp, 1ep" under cost-descending
  // order — fewest coins mathematically, but not what any table hands
  // over). Authored order fixes this by never reaching for Electrum unless
  // a GM deliberately lists it ahead of sp/cp.
  denominations.forEach((denom) => {
    const count = Math.floor(remaining / denom.cost);
    if (count > 0) {
      result[denom.shortName] = count;
      remaining -= count * denom.cost;
    }
  });
  if (remaining > 0) {
    // The smallest-COST denomination specifically has to absorb any
    // leftover that doesn't evenly divide — not "whichever is listed
    // last" (the last-listed one, e.g. Electrum, is usually not the
    // lowest-value coin) — so nothing vanishes into the wrong denomination.
    const smallest = [...denominations].sort((a, b) => a.cost - b.cost)[0];
    result[smallest.shortName] = (result[smallest.shortName] || 0) + remaining;
  }
  return result;
}

// Converts a base-unit AMOUNT (e.g. an item's price, not a whole purse)
// into the same fewest-coins shape, for display. Thin wrapper over
// baseUnitsToCurrency — its own named export since "price this many base
// units" and "break down this whole purse" are conceptually different
// callers even though the math is identical.
export function baseUnitsToPriceBreakdown(baseUnits, denominations) {
  return baseUnitsToCurrency(baseUnits, denominations);
}

// A rolled/priced AMOUNT expressed in ONE denomination (item-pricing.js's
// roundPrice deliberately keeps these fractional now — 2.5 "gp" is a real
// price) -> "2 gp, 5 sp" broken across whatever denominations the System
// has, like a real cashier making change rather than a raw decimal. Rounds
// to the nearest WHOLE base unit — lossless for any price not already
// finer than that.
export function formatPriceAmount(amount, denomination, denominations) {
  if (!Number.isFinite(amount)) return "";
  if (!Array.isArray(denominations) || !denominations.length) {
    return `${amount.toLocaleString()} ${denomination}`;
  }
  const cost = denominations.find((entry) => entry.shortName === denomination)?.cost || 1;
  const baseUnits = Math.round(amount * cost);
  return formatCurrencyBreakdown(baseUnitsToCurrency(baseUnits, denominations), denominations);
}

// A per-unit AMOUNT × a quantity -> the formatted TOTAL, rounding the
// per-unit amount to the nearest whole base unit FIRST, only THEN
// multiplying by quantity — not the reverse. Those two orders land on
// different totals whenever the per-unit amount isn't itself a whole base
// unit, and a bulk total that isn't exactly quantity × the SAME per-unit
// price shown elsewhere reads as broken math. Shared so
// shop-transactions.js's sellToShop and any preview UI can never drift
// onto two different rounding orders.
export function formatPriceTotal(unitAmount, quantity, denomination, denominations) {
  if (!Number.isFinite(unitAmount) || !Number.isFinite(quantity)) return "";
  if (!Array.isArray(denominations) || !denominations.length) {
    return `${(unitAmount * quantity).toLocaleString()} ${denomination}`;
  }
  const cost = denominations.find((entry) => entry.shortName === denomination)?.cost || 1;
  const perUnitBaseUnits = Math.round(unitAmount * cost);
  return formatCurrencyBreakdown(baseUnitsToCurrency(perUnitBaseUnits * quantity, denominations), denominations);
}

// Human-readable "2 gp, 5 sp" — largest-to-smallest, only nonzero
// denominations, falling back to "0 <smallest>" the same way
// travel-means.js's own formatCopperAsCurrency does for a free/empty
// result (never a blank string).
export function formatCurrencyBreakdown(currency, denominations) {
  if (!Array.isArray(denominations) || !denominations.length) return "";
  const sorted = [...denominations].sort((a, b) => b.cost - a.cost);
  const parts = sorted
    .map((denom) => ({ shortName: denom.shortName, amount: Number(currency?.[denom.shortName]) || 0 }))
    .filter((entry) => entry.amount > 0)
    .map((entry) => `${entry.amount.toLocaleString()} ${entry.shortName}`);
  if (parts.length) return parts.join(", ");
  const smallest = sorted[sorted.length - 1];
  return `0 ${smallest.shortName}`;
}
