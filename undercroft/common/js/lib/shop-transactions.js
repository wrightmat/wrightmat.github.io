// Shared "interactive shop" orchestration — modeled on marker-contents.js's
// claim flow (same fetch-fresh/mutate/save shape, same Group Log write,
// same recipient-override mechanism), since a shop purchase and a
// map-marker loot claim are the same transaction: move an item/currency
// between a shared pool and a Character. See marker-contents.js's header
// for why every function here takes its dependencies as explicit params,
// no module-level state.
//
// A shop's live inventory is a Group Property, keyed `shop:<locationId>` —
// NOT new fields on the Location record. This gives every member narrow,
// already-built write access (server/groups.py's public-property
// mechanism) with zero new server code, and live sync for free (Group
// Property changes already live on the "group" kind, tracked by live.js's SSE).
import { persistGroupPropertyValue } from "./group-live-sync.js";
import { resolveOwnCharacter } from "./marker-contents.js";
import { loadRarityPriceRanges, rollItemPrices, rollResourcePrice, roundPrice, PRICE_CHECK_TIERS } from "./item-pricing.js";
import { findKindReferenceRecord } from "./library-reference.js";
import { isSpellForm } from "./content-feature-matching.js";
import {
  loadSystemCurrencyDenominations,
  currencyToBaseUnits,
  baseUnitsToCurrency,
  baseUnitsToPriceBreakdown,
  formatPriceAmount,
} from "./currency.js";

function shopPropertyKey(locationId) {
  return `shop:${locationId}`;
}

// Whether a Location's own Features make it a shop — the base `feat.shop`
// tag counts, but so does ANY of its shop-type siblings (`feat.shop-
// weapons`, ...) alone, even without `feat.shop` present. Those siblings
// declare `dependsOn: ["feat.shop"]`, but Sanctum's manual "Add Feature"
// flow never enforces dependsOn (only the generator's traversal does), so a
// GM adding just "Shop: General Goods" needs this to still count. Shared by
// Sanctum's Open/Close controls and the Dashboard's shop picker so the two
// can't independently drift.
export function locationIsShop(featureIds) {
  return Array.isArray(featureIds) && featureIds.some((id) => id === "feat.shop" || id.startsWith("feat.shop-"));
}

// A Group Property's VALUE can be written by any member once its SCHEMA
// entry exists with `public: true` (server/groups.py only waives that
// check for owner/admin). openShop is GM-triggered so it can always write
// regardless, but if the schema entry doesn't exist yet, no PLAYER could
// ever write to this key afterward (every buy/sell would 403). Ensures the
// schema entry exists before any value is written.
async function ensureShopPropertySchema(dataManager, groupId, key, label) {
  const result = await dataManager.get("group", groupId, { preferLocal: false });
  const properties = Array.isArray(result?.payload?.properties) ? result.payload.properties : [];
  if (properties.some((property) => property?.key === key)) return;
  await dataManager.updateGroup({ id: groupId, properties: [...properties, { key, label, public: true }] });
}

// Prices one Location Asset, three tiers: (1) a GM-set fixed price on the
// Asset always wins; (2) failing that, a linked Wonder's own `rarity`
// drives a rolled price via item-pricing.js's rollItemPrices (same module
// the Dashboard's Item Price calculator uses); (3) failing that (a
// non-Wonder Asset, or a Wonder whose rarity doesn't resolve), the linked
// entity's own freeform "3d4x125 gp" price string is parsed via
// rollResourcePrice. An Asset priceable by none of the three is skipped —
// no price means it can't meaningfully be shop stock.
async function priceAsset(asset, { dataManager, systemId, rarityRanges }) {
  if (Number.isFinite(asset.price)) {
    return { amount: asset.price, denomination: "gp" };
  }
  if (!asset.refId) return null;
  let payload;
  try {
    const result = await dataManager.get(asset.kind, asset.refId, { preferLocal: true });
    payload = result?.payload;
  } catch (error) {
    return null;
  }
  if (asset.kind === "wonder") {
    // A Wonder's rarity lives under its System-defined `properties` bag
    // (the same generator-property home Rarity/Activation/Item Form share
    // — vault/js/app.js's Identity box reads it from the same place), never
    // a top-level `rarity` field.
    const wonderRarity = payload?.properties?.rarity;
    const range = rarityRanges.find((entry) => entry.id === wonderRarity || entry.name === wonderRarity);
    if (range) {
      const { buyPrice } = rollItemPrices(range.priceMin, range.priceMax);
      return { amount: buyPrice, denomination: "gp" };
    }
  }
  const rolled = rollResourcePrice(payload?.price);
  return rolled ? { amount: rolled.buyPrice, denomination: rolled.denomination } : null;
}

// Materializes a Location's own quantified Assets into a live, transactable
// Group Property. Only Assets the GM has given a `quantity` to (Sanctum's
// optional field) become shop stock; every other Asset (the vast majority,
// under Sanctum's "broad strokes, not a ledger" design) is left untouched.
export async function openShop({ dataManager, groupId, locationId, treasury = null, currency = "personal" }) {
  if (!dataManager || !groupId || !locationId) {
    throw new Error("Missing required openShop parameters.");
  }
  const locationResult = await dataManager.get("location", locationId, { preferLocal: false });
  const location = locationResult?.payload || {};
  const assets = Array.isArray(location.assets) ? location.assets : [];
  const quantified = assets.filter((asset) => Number.isFinite(asset.quantity));

  const groupResult = await dataManager.get("group", groupId, { preferLocal: false });
  const systemId = groupResult?.payload?.systemId || groupResult?.payload?.system_id || "";
  const rarityRanges = systemId ? await loadRarityPriceRanges(dataManager, systemId) : [];

  const items = [];
  for (const asset of quantified) {
    const price = await priceAsset(asset, { dataManager, systemId, rarityRanges });
    if (!price) continue; // no way to price this one — not stocked, Location asset untouched
    items.push({ refKind: asset.kind, refId: asset.refId, label: asset.label, price, stock: asset.quantity });
  }

  const key = shopPropertyKey(locationId);
  await ensureShopPropertySchema(dataManager, groupId, key, `Shop: ${location.name || locationId}`);
  const value = { currency: currency === "party" ? "party" : "personal", treasury, items };
  await persistGroupPropertyValue({ dataManager, groupId, key, value });
  return value;
}

// A GM's manual override of one already-open item's price — priceAsset's
// roll is a starting suggestion, not permanent; a GM can hand-adjust one
// item's cost without closing and reopening the whole shop.
export async function setShopItemPrice({ dataManager, groupId, locationId, refId, amount, denomination = "gp" }) {
  if (!dataManager || !groupId || !locationId || !refId || !Number.isFinite(amount)) {
    throw new Error("Missing required setShopItemPrice parameters.");
  }
  const key = shopPropertyKey(locationId);
  const { propertyValues } = await dataManager.getGroupProperties(groupId);
  const shop = propertyValues?.[key];
  if (!shop || !Array.isArray(shop.items)) {
    throw new Error("This shop isn't open.");
  }
  const price = { amount: Math.max(0, Math.round(amount)), denomination };
  const items = shop.items.map((item) => (item.refId === refId ? { ...item, price } : item));
  await persistGroupPropertyValue({ dataManager, groupId, key, value: { ...shop, items } });
  return price;
}

// Reverses openShop — reads the shop's current (post-trading) stock,
// optionally writes it back onto the Location's Assets as their new
// `quantity` (a GM's explicit opt-in choice, not automatic), then clears
// the Group Property's value. The schema entry is left in place so
// re-opening the same Location's shop later needs no re-creation.
export async function closeShop({ dataManager, groupId, locationId, persistToLocation = false }) {
  if (!dataManager || !groupId || !locationId) {
    throw new Error("Missing required closeShop parameters.");
  }
  const key = shopPropertyKey(locationId);
  const { propertyValues } = await dataManager.getGroupProperties(groupId);
  const shop = propertyValues?.[key];

  if (persistToLocation && shop && Array.isArray(shop.items)) {
    const locationResult = await dataManager.get("location", locationId, { preferLocal: false });
    const freshLocation = locationResult?.payload || {};
    const assets = Array.isArray(freshLocation.assets) ? [...freshLocation.assets] : [];
    shop.items.forEach((item) => {
      const index = assets.findIndex((asset) => asset.kind === item.refKind && asset.refId === item.refId);
      if (index !== -1) assets[index] = { ...assets[index], quantity: item.stock };
    });
    freshLocation.assets = assets;
    await dataManager.save("location", locationId, freshLocation);
  }

  await persistGroupPropertyValue({ dataManager, groupId, key, value: null });
  return true;
}

// Resolves who a purchase/sale applies to — an explicit GM recipient
// override (same {type:"character",characterId,label} | {type:"party"}
// shape as marker-contents.js's resolveGiveToOptions) when given, otherwise
// the acting player's own Character. A bare id-only fetch is enough here —
// every non-GM caller already has its own resolved Character going in.
async function resolveShopCharacter(dataManager, groupId, shareToken, recipient) {
  if (recipient?.type === "character" && recipient.characterId) {
    const result = await dataManager.get("character", recipient.characterId, { preferLocal: false }).catch(() => null);
    if (!result?.payload) return null;
    return { id: recipient.characterId, label: recipient.label || result.payload.name || recipient.characterId };
  }
  return resolveOwnCharacter(dataManager, groupId, shareToken);
}

// Same PRICE_CHECK_TIERS multiplier the Dashboard's Item Price calculator
// applies (buyMultiplier discounts a purchase, sellMultiplier improves a
// sale — see quoteSaleToShop below), the "how did the haggling check go"
// lever applied to a real transaction. "none" is multiplier 1 for buying.
function applyBuyCheckTier(amount, checkTierId) {
  const tier = PRICE_CHECK_TIERS.find((entry) => entry.id === checkTierId) || PRICE_CHECK_TIERS.find((entry) => entry.id === "none");
  return roundPrice(amount * tier.buyMultiplier);
}

// Buys ONE unit of one shop item. Fetch-fresh immediately before validating
// (guards the rare race of two buyers on the last unit) and again before
// the currency write, matching every other fetch-fresh-then-write in this
// suite (map-live-sync.js's persistElementUpdate, marker-contents.js's own
// claim writes).
export async function buyFromShop({ dataManager, groupId, shareToken = "", locationId, refId, recipient = null, checkTierId = "none" }) {
  if (!dataManager || !groupId || !locationId || !refId) {
    throw new Error("Missing required buyFromShop parameters.");
  }
  const key = shopPropertyKey(locationId);
  const { propertyValues } = await dataManager.getGroupProperties(groupId);
  const shop = propertyValues?.[key];
  if (!shop || !Array.isArray(shop.items)) {
    throw new Error("This shop isn't open.");
  }
  const item = shop.items.find((entry) => entry.refId === refId);
  if (!item || (Number.isFinite(item.stock) && item.stock <= 0)) {
    throw new Error("That item is out of stock.");
  }

  // An explicit recipient (a GM's "Buying for" pick) always wins over the
  // shop's default currency mode — Party is always available regardless of
  // the shop's own default. Absent an explicit recipient, the shop's
  // default mode decides.
  const payFromParty = recipient?.type === "party" || (!recipient && shop.currency === "party");
  const character = payFromParty ? null : await resolveShopCharacter(dataManager, groupId, shareToken, recipient);
  if (!payFromParty && !character) {
    throw new Error("You don't have a character in this campaign to buy with.");
  }

  const denomination = item.price?.denomination || "gp";
  const amount = applyBuyCheckTier(item.price?.amount || 0, checkTierId);
  // Affordability and payment are about TOTAL VALUE, never one specific
  // denomination (same reasoning as currency.js's header) — a buyer with
  // plenty of silver but no gold could still afford a gold-priced item.
  const groupResultForCurrency = await dataManager.get("group", groupId, { preferLocal: false });
  const currencySystemId = groupResultForCurrency?.payload?.systemId || groupResultForCurrency?.payload?.system_id || "";
  let denominations = currencySystemId ? await loadSystemCurrencyDenominations(dataManager, currencySystemId) : [];
  // A System with no "currency" field can't convert anything — falls back
  // to a single synthetic denomination (cost 1) matching the item's own, so
  // conversion below is a no-op rather than failing the purchase outright.
  if (!denominations.length) denominations = [{ shortName: denomination, cost: 1 }];
  const priceBaseUnits = Math.round(amount * (denominations.find((d) => d.shortName === denomination)?.cost || 1));
  let buyerLabel;
  if (character) {
    const characterResult = await dataManager.get("character", character.id, { preferLocal: false });
    const freshCharacter = characterResult.payload || {};
    const currencies = freshCharacter.currencies && typeof freshCharacter.currencies === "object" ? freshCharacter.currencies : {};
    const currencyBaseUnits = currencyToBaseUnits(currencies, denominations);
    if (currencyBaseUnits < priceBaseUnits) {
      const shortfall = baseUnitsToPriceBreakdown(priceBaseUnits - currencyBaseUnits, denominations);
      throw new Error(`Not enough funds — short ${Object.entries(shortfall).map(([short, amt]) => `${amt} ${short}`).join(", ")}.`);
    }
    // Re-minted into the fewest coins that cover the remainder ("change"),
    // not just decremented in the price's one denomination — a purchase
    // paid partly in smaller coin doesn't leave an invalid intermediate state.
    freshCharacter.currencies = baseUnitsToCurrency(currencyBaseUnits - priceBaseUnits, denominations);
    const inventoryItem = { name: item.label || refId, quantity: 1, notes: "" };
    // Same refKind/refId shape every reference in this suite uses — NOT a
    // bespoke `wonderId` field, which component-renderers.js's chip
    // auto-render (isReferenceValue) can't recognize. ANY refKind, not just
    // "wonder" — a resource-priced shop item has a real refKind/refId too.
    if (item.refKind && refId) {
      inventoryItem.refKind = item.refKind;
      inventoryItem.refId = refId;
    }
    freshCharacter.inventory = [...(Array.isArray(freshCharacter.inventory) ? freshCharacter.inventory : []), inventoryItem];
    await dataManager.save("character", character.id, freshCharacter);
    buyerLabel = character.label;
  } else {
    // Party currency mode — see marker-contents.js's PARTY_CURRENCY_KEY for
    // the same {shortName: amount} shape. Same total-value conversion as
    // the character branch above.
    const { propertyValues: freshValues } = await dataManager.getGroupProperties(groupId);
    const currencies = freshValues?.currencies && typeof freshValues.currencies === "object" ? freshValues.currencies : {};
    const partyBaseUnits = currencyToBaseUnits(currencies, denominations);
    if (partyBaseUnits < priceBaseUnits) {
      const shortfall = baseUnitsToPriceBreakdown(priceBaseUnits - partyBaseUnits, denominations);
      throw new Error(`The party doesn't have enough — short ${Object.entries(shortfall).map(([short, amt]) => `${amt} ${short}`).join(", ")}.`);
    }
    await persistGroupPropertyValue({
      dataManager,
      groupId,
      key: "currencies",
      value: baseUnitsToCurrency(partyBaseUnits - priceBaseUnits, denominations),
    });
    buyerLabel = "the party";
  }

  const { propertyValues: freshShopValues } = await dataManager.getGroupProperties(groupId);
  const freshShop = freshShopValues?.[key];
  if (!freshShop) throw new Error("This shop isn't open.");
  const freshItem = freshShop.items.find((entry) => entry.refId === refId);
  if (!freshItem || (Number.isFinite(freshItem.stock) && freshItem.stock <= 0)) {
    throw new Error("Someone already bought the last one.");
  }
  const updatedItems = freshShop.items
    .map((entry) => (entry.refId === refId ? { ...entry, stock: Number.isFinite(entry.stock) ? entry.stock - 1 : entry.stock } : entry))
    .filter((entry) => !Number.isFinite(entry.stock) || entry.stock > 0);
  await persistGroupPropertyValue({ dataManager, groupId, key, value: { ...freshShop, items: updatedItems } });

  void dataManager
    .createGroupLogEntry({
      groupId,
      shareToken,
      type: "message",
      message: `${buyerLabel} bought ${item.label || refId} for ${formatPriceAmount(amount, denomination, denominations)}.`,
    })
    .catch(() => {});

  return { label: item.label || refId, price: amount, denomination, buyerLabel };
}

// Resolves what ONE inventory item would sell for right now, using the
// same three-tier resolution sellToShop uses, WITHOUT mutating anything.
// The price is a fresh roll, so the "Sell for how much?" confirm prompt
// calls this first to show a real number, then calls sellToShop passing
// THIS EXACT return value as `quote` — what the GM confirmed is exactly
// what happens, not a second independent roll. `checkTierId` is the same
// haggling-check lever the Dashboard's Item Price calculator offers
// (PRICE_CHECK_TIERS) — rollItemPrices applies sellMultiplier itself.
export async function quoteSaleToShop({
  dataManager, groupId, locationId, sellerCharacterId, inventoryIndex, manualRarityId = null, checkTierId = "none",
}) {
  if (!dataManager || !groupId || !locationId || !sellerCharacterId || !Number.isFinite(inventoryIndex)) {
    throw new Error("Missing required quoteSaleToShop parameters.");
  }
  const key = shopPropertyKey(locationId);
  const { propertyValues } = await dataManager.getGroupProperties(groupId);
  if (!propertyValues?.[key]) throw new Error("This shop isn't open.");

  const characterResult = await dataManager.get("character", sellerCharacterId, { preferLocal: false });
  const inventory = Array.isArray(characterResult.payload?.inventory) ? characterResult.payload.inventory : [];
  const inventoryItem = inventory[inventoryIndex];
  if (!inventoryItem) throw new Error("That item is no longer in your inventory.");

  // Tier 1: already stamped (character import, or a previous shop purchase
  // — refKind/refId, not a bespoke `wonderId` field).
  let refId = inventoryItem.refKind === "wonder" ? inventoryItem.refId || null : null;
  let rarityId = manualRarityId;
  if (!refId && !rarityId) {
    // Tier 2: a live name-match against the Wonder library
    // (findKindReferenceRecord, same lookup Feature reference chips use),
    // excluding spell-form Wonders — a sold ITEM should never match a
    // same-named spell ("Shield" the spell vs a Shield of armor).
    const match = await findKindReferenceRecord(dataManager, "wonder", inventoryItem.name, { filter: (entry) => !isSpellForm(entry) });
    if (match) refId = match.id;
  }
  if (!refId && !rarityId) {
    // Tier 3 never got a manual pick either — nothing left to price with.
    throw new Error("Couldn't identify this item — ask your GM to price it by rarity.");
  }

  const groupResult = await dataManager.get("group", groupId, { preferLocal: false });
  const systemId = groupResult?.payload?.systemId || groupResult?.payload?.system_id || "";
  const rarityRanges = systemId ? await loadRarityPriceRanges(dataManager, systemId) : [];
  let range = null;
  if (rarityId) {
    range = rarityRanges.find((entry) => entry.id === rarityId || entry.name === rarityId); // tier 3
  } else if (refId) {
    // Same properties.rarity home as priceAsset's identical fix.
    const wonderResult = await dataManager.get("wonder", refId, { preferLocal: true }).catch(() => null);
    const wonderRarity = wonderResult?.payload?.properties?.rarity;
    range = rarityRanges.find((entry) => entry.id === wonderRarity || entry.name === wonderRarity);
    if (!range) {
      // No rarity at all — ordinary equipment (a Shield, tools, …) never
      // has one, only magic items do. Falls back to the Wonder's own
      // freeform price string (item-pricing.js's rollResourcePrice — the
      // sell-side twin of priceAsset's own fallback for shop STOCK).
      const rolled = rollResourcePrice(wonderResult?.payload?.price, { checkTierId });
      if (rolled) {
        return { label: inventoryItem.name, price: rolled.sellPrice, denomination: rolled.denomination, refId, priceMax: rolled.buyPrice };
      }
    }
  }
  if (!range) throw new Error("Couldn't price this item — it has no rarity or price data to sell against.");
  const { sellPrice } = rollItemPrices(range.priceMin, range.priceMax, { checkTierId });
  return { label: inventoryItem.name, price: sellPrice, denomination: "gp", refId: refId || null, priceMax: range.priceMax };
}

// Sells one or more units of one inventory item TO the shop — the inverse
// of buyFromShop. `quote` (optional) is a previous quoteSaleToShop return
// value to commit EXACTLY as quoted, no re-roll — omit to resolve+roll
// fresh in one call. `quantity` (default 1) sells that many units of the
// SAME stack at the SAME per-unit price in one save, letting "Sell All"
// commit in one fetch/mutate/save instead of N round trips.
export async function sellToShop({
  dataManager,
  groupId,
  shareToken = "",
  locationId,
  sellerCharacterId,
  inventoryIndex,
  manualRarityId = null,
  quote = null,
  quantity = 1,
}) {
  if (!dataManager || !groupId || !locationId || !sellerCharacterId || !Number.isFinite(inventoryIndex)) {
    throw new Error("Missing required sellToShop parameters.");
  }
  if (!Number.isFinite(quantity) || quantity < 1) quantity = 1;
  const resolved =
    quote || (await quoteSaleToShop({ dataManager, groupId, locationId, sellerCharacterId, inventoryIndex, manualRarityId }));
  const { label, price: sellPrice, denomination, refId, priceMax } = resolved;

  const key = shopPropertyKey(locationId);
  const { propertyValues } = await dataManager.getGroupProperties(groupId);
  const shop = propertyValues?.[key];
  if (!shop) throw new Error("This shop isn't open.");

  // Same total-value conversion as buyFromShop — the sell price and the
  // shop's treasury/seller's purse aren't guaranteed to share one
  // denomination, so every comparison and write below goes through base units.
  const groupResultForCurrency = await dataManager.get("group", groupId, { preferLocal: false });
  const currencySystemId = groupResultForCurrency?.payload?.systemId || groupResultForCurrency?.payload?.system_id || "";
  let denominations = currencySystemId ? await loadSystemCurrencyDenominations(dataManager, currencySystemId) : [];
  if (!denominations.length) denominations = [{ shortName: denomination, cost: 1 }];
  const sellPriceCost = denominations.find((d) => d.shortName === denomination)?.cost || 1;
  // Rounded to the nearest whole base unit PER UNIT, then multiplied by
  // quantity — not the reverse. sellPrice can be fractional (roundPrice
  // deliberately preserves e.g. 2.5 "gp"), and rounding the aggregate
  // independently of the per-unit price can land on a different total than
  // "the shown per-unit price times however many units." Rounding per unit
  // first guarantees "Sell All" is always exactly that many times the SAME
  // per-unit price the quote already shows.
  const sellPriceBaseUnits = Math.round(sellPrice * sellPriceCost) * quantity;

  if (shop.treasury && Number.isFinite(shop.treasury.amount)) {
    const treasuryCost = denominations.find((d) => d.shortName === shop.treasury.denomination)?.cost || 1;
    if (shop.treasury.amount * treasuryCost < sellPriceBaseUnits) {
      throw new Error("This shop can't afford to buy that right now.");
    }
  }

  const characterResult = await dataManager.get("character", sellerCharacterId, { preferLocal: false });
  const freshCharacter = characterResult.payload || {};
  const inventory = Array.isArray(freshCharacter.inventory) ? freshCharacter.inventory : [];
  const inventoryItem = inventory[inventoryIndex];
  // Re-checks the item is still the SAME one just quoted, not merely
  // present — the two-call quote-then-commit flow opens a gap where
  // something else changes this inventory between quote and confirm.
  if (!inventoryItem || inventoryItem.name !== label) {
    throw new Error("That item is no longer in your inventory — the quoted price may be stale.");
  }
  const ownedQuantity = Number.isFinite(inventoryItem.quantity) ? inventoryItem.quantity : 1;
  if (quantity > ownedQuantity) {
    throw new Error(`You only have ${ownedQuantity}.`);
  }

  // Quantity-aware removal, the mirror of buyFromShop's inventory-add — a
  // stack of 10 Rations selling ONE unit must decrement to 9, not vanish.
  const existingCurrencyBaseUnits = currencyToBaseUnits(freshCharacter.currencies, denominations);
  freshCharacter.currencies = baseUnitsToCurrency(existingCurrencyBaseUnits + sellPriceBaseUnits, denominations);
  const remainingQuantity = ownedQuantity - quantity;
  freshCharacter.inventory =
    remainingQuantity > 0
      ? inventory.map((entry, index) => (index === inventoryIndex ? { ...entry, quantity: remainingQuantity } : entry))
      : inventory.filter((_, index) => index !== inventoryIndex);
  await dataManager.save("character", sellerCharacterId, freshCharacter);

  const { propertyValues: freshShopValues } = await dataManager.getGroupProperties(groupId);
  const freshShop = freshShopValues?.[key];
  if (freshShop) {
    const items = Array.isArray(freshShop.items) ? [...freshShop.items] : [];
    const existingIndex = refId ? items.findIndex((entry) => entry.refId === refId) : -1;
    if (existingIndex !== -1) {
      items[existingIndex] = { ...items[existingIndex], stock: (items[existingIndex].stock || 0) + quantity };
    } else if (refId) {
      items.push({ refKind: "wonder", refId, label, price: { amount: priceMax, denomination }, stock: quantity });
    }
    let treasury = freshShop.treasury;
    if (treasury && Number.isFinite(treasury.amount)) {
      const treasuryCost = denominations.find((d) => d.shortName === treasury.denomination)?.cost || 1;
      const remainingBaseUnits = Math.max(0, treasury.amount * treasuryCost - sellPriceBaseUnits);
      treasury = { ...treasury, amount: Math.floor(remainingBaseUnits / treasuryCost) };
    }
    await persistGroupPropertyValue({ dataManager, groupId, key, value: { ...freshShop, items, treasury } });
  }

  const totalLabel = quantity > 1 ? `${quantity} × ${label}` : label;
  const totalPriceText = formatPriceAmount(sellPriceBaseUnits / sellPriceCost, denomination, denominations);
  void dataManager
    .createGroupLogEntry({
      groupId,
      shareToken,
      type: "message",
      message: `${freshCharacter.name || "A character"} sold ${totalLabel} for ${totalPriceText}.`,
    })
    .catch(() => {});

  return { label, price: sellPrice, denomination, quantity, totalPrice: sellPriceBaseUnits / sellPriceCost };
}
