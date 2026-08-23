// Shared "interactive shop" orchestration — modeled directly on
// marker-contents.js's own claim flow (same fetch-fresh/mutate/save shape
// for currency and inventory, same Group Log write, same recipient-override
// mechanism), because a shop purchase and a map-marker loot claim are the
// same underlying transaction: move an item/currency between a shared pool
// and a Character. See marker-contents.js's own header for why every
// function here takes its dependencies as explicit parameters, no
// module-level state.
//
// A shop's own live inventory is a Group Property, keyed `shop:<locationId>`
// — NOT new fields on the Location record itself. This is what gives every
// member narrow, already-built write access (server/groups.py's own
// public-property mechanism) with zero new server code, and live sync for
// free (Group Property changes already live on the "group" kind, already
// tracked by live.js's own SSE). See this feature's own plan
// (mellow-pondering-dijkstra.md) for the full reasoning.
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
// weapons`, `feat.shop-general-goods`, ...) on its own, even without
// `feat.shop` also present. Those sibling Features each declare
// `dependsOn: ["feat.shop"]`, so pairing the two together is the
// documented, complete way to tag one — but Sanctum's own manual "Add
// Feature" flow never enforces a Feature's own dependsOn (that's read only
// by the GENERATOR's traversal, not manual authoring), so a GM who adds
// just "Shop: General Goods" and reasonably expects that alone to mean
// "this is a shop" would otherwise see nothing here at all. Shared by both
// Sanctum's own Open/Close controls and the Dashboard widget's own shop
// picker, so the two can never independently drift on what counts.
export function locationIsShop(featureIds) {
  return Array.isArray(featureIds) && featureIds.some((id) => id === "feat.shop" || id.startsWith("feat.shop-"));
}

// A Group Property's VALUE can be written by any member once its own
// SCHEMA entry (in the group's `properties` array) exists with
// `public: true` — server/groups.py's update_group_property_value only
// waives that check for the owner/admin (see that function's own
// is_owner_or_admin branch). openShop is always GM-triggered, so it's
// always allowed to write the value regardless — but if the schema entry
// doesn't exist yet, no PLAYER could ever write to this same key
// afterward (every buy/sell would 403). This ensures the schema entry
// exists — a genuinely new schema key gets appended, an already-present
// one (a shop that's been opened before) is left untouched — before any
// value is ever written.
async function ensureShopPropertySchema(dataManager, groupId, key, label) {
  const result = await dataManager.get("group", groupId, { preferLocal: false });
  const properties = Array.isArray(result?.payload?.properties) ? result.payload.properties : [];
  if (properties.some((property) => property?.key === key)) return;
  await dataManager.updateGroup({ id: groupId, properties: [...properties, { key, label, public: true }] });
}

// Prices one Location Asset, three tiers: (1) a GM-set fixed price on the
// Asset entry itself always wins outright; (2) failing that, a linked
// Wonder's own `rarity` drives a rolled price via item-pricing.js's
// rollItemPrices (the same module the Dashboard's own Item Price calculator
// already uses); (3) failing THAT (a non-Wonder Asset — Resources have no
// rarity concept at all — or a Wonder whose own rarity doesn't resolve to a
// priced range), the linked entity's own freeform "3d4x125 gp"-style price
// string (Resource's own documented price convention) is parsed and rolled
// via rollResourcePrice — item-pricing.js's own sibling tier for exactly
// this case. An Asset priceable by NONE of the three is skipped entirely —
// no price means nothing to sell it for, so it can't meaningfully be shop
// stock.
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
    // A Wonder's own rarity lives under its System-defined `properties`
    // bag (the same generator-property home Rarity/Activation/Item Form
    // all share — vault/js/app.js's own Identity box reads it from the
    // exact same place), never a top-level `rarity` field. Confirmed real
    // bug this fixes: every wonder-kind shop item has been silently
    // un-priceable via rarity this whole time, always falling straight to
    // the resource-price-expression tier below (which a magic item has no
    // reason to have) instead of ever finding a match here.
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
// Group Property. Only Assets the GM has explicitly given a `quantity` to
// (Sanctum's own new optional field — see that tool's own CLAUDE.md update)
// become shop stock; every other Asset on the Location (the vast majority,
// under Sanctum's own "broad strokes, not a ledger" design) is left alone,
// on the Location, untouched.
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

// A GM's own manual override of one already-open item's price — openShop's
// own priceAsset roll (rarity range or a Resource's own dice-expression) is
// a starting suggestion, never a permanent one; a GM should always be able
// to hand-adjust what one specific item costs afterward (a bad roll, a
// deliberate loss-leader, a haggling outcome) without closing and reopening
// the whole shop just to reprice one thing. Fetch-fresh/mutate/write, same
// shape as every other shop-property write in this module.
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
// optionally writes it back onto the Location's own Assets as their new
// `quantity` (a GM's explicit choice, not automatic — see the plan's own
// "Design decisions" for why this is opt-in), then clears the Group
// Property's own value. The schema entry itself is left in place (harmless,
// and means re-opening the same Location's shop later needs no re-creation).
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

// Resolves who a purchase/sale actually applies to — an explicit GM
// recipient override (same {type:"character",characterId,label} |
// {type:"party"} shape marker-contents.js's own resolveGiveToOptions
// produces) when given, otherwise the acting player's own Character. A
// bare id-only fetch here (not resolveClaimCharacter's own fuller
// re-fetch-by-id-with-label-fallback) is enough — this module never needs
// the "fetch a specific OTHER character's own record" no-recipient-given
// case marker-contents.js's version also handles, since every non-GM
// caller here already has their own resolved Character going in.
async function resolveShopCharacter(dataManager, groupId, shareToken, recipient) {
  if (recipient?.type === "character" && recipient.characterId) {
    const result = await dataManager.get("character", recipient.characterId, { preferLocal: false }).catch(() => null);
    if (!result?.payload) return null;
    return { id: recipient.characterId, label: recipient.label || result.payload.name || recipient.characterId };
  }
  return resolveOwnCharacter(dataManager, groupId, shareToken);
}

// Same PRICE_CHECK_TIERS multiplier the Dashboard's own Item Price
// calculator applies to its one rolled base price — reused here as-is
// (buyMultiplier discounts a purchase, sellMultiplier — see
// quoteSaleToShop below — improves a sale), same "how did the PC's
// haggling check go" lever, just applied to a real shop transaction
// instead of a standalone calculator result. "none" (no check rolled) is
// multiplier 1 for buying — byte-identical to every purchase before this
// feature existed.
function applyBuyCheckTier(amount, checkTierId) {
  const tier = PRICE_CHECK_TIERS.find((entry) => entry.id === checkTierId) || PRICE_CHECK_TIERS.find((entry) => entry.id === "none");
  return roundPrice(amount * tier.buyMultiplier);
}

// Buys ONE unit of one shop item. Fetch-fresh immediately before validating
// (guards the rare race of two buyers on the last unit — if stock already
// dropped below what the caller last saw, this throws a clear "someone
// already bought that" rather than silently going negative) and again
// before the currency write (same reasoning), matching every other
// fetch-fresh-then-write in this suite (map-live-sync.js's
// persistElementUpdate, marker-contents.js's own claim writes).
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

  // An explicit recipient (a GM's own "Buying for" pick) always wins over
  // the shop's own default currency mode — Party is a real, always-
  // available choice regardless of whether this particular shop's own
  // default is "personal" or "party", not just when the two happen to
  // agree. Absent an explicit recipient (every non-GM buyer), the shop's
  // own default mode decides, exactly as before.
  const payFromParty = recipient?.type === "party" || (!recipient && shop.currency === "party");
  const character = payFromParty ? null : await resolveShopCharacter(dataManager, groupId, shareToken, recipient);
  if (!payFromParty && !character) {
    throw new Error("You don't have a character in this campaign to buy with.");
  }

  const denomination = item.price?.denomination || "gp";
  const amount = applyBuyCheckTier(item.price?.amount || 0, checkTierId);
  // Affordability and payment are about TOTAL VALUE, never one specific
  // denomination — the same "someone can pay with a pile of pennies"
  // reasoning currency.js's own header explains. A buyer with plenty of
  // silver but no gold on hand could still afford a gold-priced item;
  // checking (and deducting from) only that one denomination was a
  // confirmed real bug, not just an inconvenience.
  const groupResultForCurrency = await dataManager.get("group", groupId, { preferLocal: false });
  const currencySystemId = groupResultForCurrency?.payload?.systemId || groupResultForCurrency?.payload?.system_id || "";
  let denominations = currencySystemId ? await loadSystemCurrencyDenominations(dataManager, currencySystemId) : [];
  // A System with no "currency" field at all (hasn't opted in) can't
  // convert anything — falls back to a single synthetic denomination
  // (cost 1) matching the item's own listed one, which makes every
  // conversion below a no-op and reproduces the exact original
  // single-denomination behavior rather than failing every purchase
  // outright for lack of data to convert with.
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
    // not just decremented in the one denomination the price happened to
    // be listed in — a purchase paid partly or fully in smaller coin
    // doesn't leave the buyer's purse in some invalid intermediate state.
    freshCharacter.currencies = baseUnitsToCurrency(currencyBaseUnits - priceBaseUnits, denominations);
    const inventoryItem = { name: item.label || refId, quantity: 1, notes: "" };
    // Same refKind/refId shape linkCharacterInventoryReferences and every
    // other reference in this suite use — NOT a bespoke `wonderId` field,
    // which component-renderers.js's own chip-auto-render (isReferenceValue)
    // has no way to recognize. ANY refKind, not just "wonder" — confirmed
    // real bug this fixes: a shop item priced off a Resource (openShop's
    // own resource-price tier, item-pricing.js's rollResourcePrice) still
    // has a perfectly real refKind/refId (`resource`), and showed as a
    // reference pill in the shop's own listing already; restricting this
    // stamp to "wonder" only silently dropped it the instant it landed in
    // a buyer's inventory, reverting to flat text for no reason tied to
    // whether it's actually a reference.
    if (item.refKind && refId) {
      inventoryItem.refKind = item.refKind;
      inventoryItem.refId = refId;
    }
    freshCharacter.inventory = [...(Array.isArray(freshCharacter.inventory) ? freshCharacter.inventory : []), inventoryItem];
    await dataManager.save("character", character.id, freshCharacter);
    buyerLabel = character.label;
  } else {
    // Party currency mode — see marker-contents.js's own PARTY_CURRENCY_KEY
    // comment for the exact same {shortName: amount} shape. Same total-
    // value conversion as the character branch above, not a single-
    // denomination check.
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
// same three-tier resolution sellToShop itself uses (see that function's
// own header) — WITHOUT mutating anything (no character save, no shop
// stock write, no log entry). The price is a fresh roll, never
// deterministic ahead of time, so the widget's own "Sell for how much?"
// confirm prompt calls this first to show a real number, then calls
// sellToShop again passing THIS EXACT return value as `quote` — so what
// the GM confirmed is exactly what happens, not a second independent roll
// landing on a different number. `checkTierId` is the same "how did the
// PC's haggling check go" lever the Dashboard's own Item Price calculator
// already offers (PRICE_CHECK_TIERS, item-pricing.js) — rollItemPrices
// itself applies the tier's own sellMultiplier, nothing bespoke here.
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

  // Tier 1: already stamped (character import, or a previous shop
  // purchase — linkCharacterInventoryReferences' own comment on why this
  // is refKind/refId, not a bespoke `wonderId` field).
  let refId = inventoryItem.refKind === "wonder" ? inventoryItem.refId || null : null;
  let rarityId = manualRarityId;
  if (!refId && !rarityId) {
    // Tier 2: a live name-match against the Wonder library
    // (findKindReferenceRecord — the same lookup Feature reference chips
    // already use), excluding spell-form Wonders — a sold ITEM should
    // never match a same-named spell (the "Shield" spell vs a Shield of
    // armor is the confirmed real case this guards against; see
    // content-feature-matching.js's own isSpellForm).
    const match = await findKindReferenceRecord(dataManager, "wonder", inventoryItem.name, { filter: (entry) => !isSpellForm(entry) });
    if (match) refId = match.id;
  }
  if (!refId && !rarityId) {
    // Tier 3 never got a manual pick either — nothing left to price this
    // with at all.
    throw new Error("Couldn't identify this item — ask your GM to price it by rarity.");
  }

  const groupResult = await dataManager.get("group", groupId, { preferLocal: false });
  const systemId = groupResult?.payload?.systemId || groupResult?.payload?.system_id || "";
  const rarityRanges = systemId ? await loadRarityPriceRanges(dataManager, systemId) : [];
  let range = null;
  if (rarityId) {
    range = rarityRanges.find((entry) => entry.id === rarityId || entry.name === rarityId); // tier 3
  } else if (refId) {
    // Same properties.rarity home as priceAsset's own identical fix.
    const wonderResult = await dataManager.get("wonder", refId, { preferLocal: true }).catch(() => null);
    const wonderRarity = wonderResult?.payload?.properties?.rarity;
    range = rarityRanges.find((entry) => entry.id === wonderRarity || entry.name === wonderRarity);
    if (!range) {
      // No rarity at all — ordinary equipment (a Shield, a set of tools, …)
      // never has one, only magic items do. Falls back to the Wonder's
      // own freeform price string (item-pricing.js's rollResourcePrice —
      // the exact same fallback priceAsset above already uses for pricing
      // shop STOCK; this is the missing sell-side twin of it). Confirmed
      // real gap this fixes: a referenced-but-mundane inventory item
      // (Shield, eff.shield.json's own "price": "10 gp") had its rarity
      // picker HIDDEN (it's tier-1 referenced, not tier-3 manual) yet
      // still had nothing to price it — no way to sell it at all.
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
// value to commit EXACTLY as quoted (its per-unit price), no re-roll — omit
// it to resolve+roll fresh in one call (a caller with no confirm-prompt
// step of its own). `quantity` (default 1) sells that many units of the
// SAME stack at that SAME per-unit price in one save cycle — matches what
// the confirm modal actually quoted rather than rolling a fresh, possibly
// different price per unit, and lets "Sell All" commit in a single
// fetch/mutate/save instead of N round trips.
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
  // shop's own treasury/the seller's own purse aren't guaranteed to share
  // one denomination (a resource-priced item can sell in sp/cp; a
  // Character's own held coin is spread across all of them), so every
  // comparison and write below goes through base units, not a raw number
  // comparison that silently assumes matching units.
  const groupResultForCurrency = await dataManager.get("group", groupId, { preferLocal: false });
  const currencySystemId = groupResultForCurrency?.payload?.systemId || groupResultForCurrency?.payload?.system_id || "";
  let denominations = currencySystemId ? await loadSystemCurrencyDenominations(dataManager, currencySystemId) : [];
  if (!denominations.length) denominations = [{ shortName: denomination, cost: 1 }];
  const sellPriceCost = denominations.find((d) => d.shortName === denomination)?.cost || 1;
  // Rounded to the nearest whole base unit (the System's own smallest
  // coin) PER UNIT, then multiplied by quantity — not the reverse
  // (rounding the aggregate raw amount once). sellPrice can be fractional
  // now (item-pricing.js's own roundPrice deliberately preserves e.g. 2.5
  // "gp" as a real price, not an imprecise one to collapse to a whole
  // number), and rounding the total independently of the per-unit price
  // can land on a different number than "the shown per-unit price times
  // however many units" — confirmed real, reported confusion (9 units at
  // a displayed 1cp each totalling something other than 9cp). Rounding
  // once per unit first guarantees the "Sell All" total is always exactly
  // that many times the SAME per-unit price this quote already shows.
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
  // present — a real gap the two-call quote-then-commit flow opens that a
  // single-call sell never had: something else could have changed this
  // character's inventory between the quote and this confirm (a purchase,
  // another sale) shifting what sits at this same index.
  if (!inventoryItem || inventoryItem.name !== label) {
    throw new Error("That item is no longer in your inventory — the quoted price may be stale.");
  }
  const ownedQuantity = Number.isFinite(inventoryItem.quantity) ? inventoryItem.quantity : 1;
  if (quantity > ownedQuantity) {
    throw new Error(`You only have ${ownedQuantity}.`);
  }

  // Same quantity-aware removal buyFromShop's own inventory-add is the
  // mirror of — a stack of 10 Rations selling ONE unit must decrement to
  // 9, not vanish the whole stack. Confirmed real, reported bug: every
  // sale removed the entire entry regardless of its own quantity.
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
