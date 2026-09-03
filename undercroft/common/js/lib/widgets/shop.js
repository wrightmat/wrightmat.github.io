// Dashboard "Shop" widget — the player-facing front end for
// shop-transactions.js's own openShop/closeShop/buyFromShop/sellToShop. A
// shop's live state is a Group Property, so this widget is mostly a thin,
// live-synced view over that plus GM-only Open/Close/treasury controls and
// a "Buying for"/"Selling as" override a GM can use to act on behalf of an
// offline player or the party.
//
// Which Location this instance shows is a per-widget-instance choice,
// stored as `{followKind:"shop", followId:<locationId>}` — the same shape
// dashboard.js's acceptSpotlight hands any INLINE_FOLLOW_KINDS widget,
// reused here as this widget's ONE contentRef shape regardless of whether
// it was added by accepting a GM's spotlight or picked by hand from the
// select below, so dashboard.js's own dashboard-membership matching
// recognizes a manually-added instance too, not only an accepted one.
import { el, setElementVisible } from "../dom.js";
import { fetchKindEntriesWithIds } from "../content-fetch.js";
import { createReferenceChip } from "../library-reference.js";
import { resolveGiveToOptions, resolveOwnCharacter } from "../marker-contents.js";
import { openShop, closeShop, buyFromShop, sellToShop, quoteSaleToShop, setShopItemPrice, locationIsShop } from "../shop-transactions.js";
import { showConfirmModal } from "../confirm-modal.js";
import { watchGroupForChanges } from "../group-live-sync.js";
import { loadRarityPriceRanges, roundPrice, PRICE_CHECK_TIERS } from "../item-pricing.js";
import {
  loadSystemCurrencyDenominations,
  currencyToBaseUnits,
  baseUnitsToPriceBreakdown,
  formatPriceAmount,
  formatPriceTotal,
} from "../currency.js";
import { resolveIsSpotlighted } from "../spotlight.js";
import { refreshTooltips, disposeTooltips, setDisabledTooltip } from "../tooltips.js";

function formatPrice(price) {
  if (!price) return "—";
  return `${(price.amount || 0).toLocaleString()} ${price.denomination || "gp"}`;
}

export function initShopWidget(
  container,
  {
    status,
    dataManager,
    groupContext = null,
    contentRef = null,
    setContentRef,
    setHeaderContent,
    setRightAction,
    canToggleVisibility = false,
  } = {}
) {
  if (!container) {
    return { destroy() {} };
  }

  let config = { followKind: "shop", followId: "", ...(contentRef || {}) };
  function persistConfig(patch) {
    config = { ...config, ...patch };
    setContentRef?.(config);
  }

  const isGm = Boolean(dataManager?.meetsTier?.("gm"));
  const groupId = groupContext?.groupId || "";
  const shareToken = groupContext?.shareToken || "";
  const shopKey = () => `shop:${config.followId}`;
  let visible = false; // is THIS Location currently spotlighted to the table

  let shopLocations = []; // [{id, name}] every Location tagged feat.shop
  let currentShop = null; // latest propertyValues[shop:<locationId>], or null when closed
  let giveToRoster = []; // resolveGiveToOptions(dataManager, groupId) — cached
  let ownCharacter = null; // resolveOwnCharacter(dataManager, groupId) — non-GM's own default
  let rarityRanges = []; // loadRarityPriceRanges — for the GM's tier-3 manual-rarity sell fallback
  let sellTargetCharacterId = ""; // whose inventory the Sell panel is currently showing
  let sellInventory = []; // that character's own current inventory array
  let currencyDenominations = []; // [{name,shortName,...}] the active System's own "currency" field values
  let latestPropertyValues = {}; // the shop's own group's full propertyValues, refreshed alongside currentShop — .currencies is the party wallet
  let buyerCurrency = null; // {[shortName]: amount} for whoever "Buying for" currently resolves to, or null while unresolved
  // The same "how did the PC's haggling check go" lever the Dashboard's
  // Item Price calculator offers — ONE shared pick for the whole shop, not
  // per-item, affecting both what a buyer pays and what a seller receives.
  // "none" is the byte-identical default every price had before this existed.
  let checkTierId = "none";
  // Sell prices are a real roll (rollItemPrices), not deterministic — cached
  // per item so it stays stable across the frequent re-renders any
  // shop-wide change triggers, only re-rolling when the item, shared check
  // tier, or manually-picked rarity actually changes. Cleared whenever
  // "Selling as" changes, since a different seller's item at the same list
  // index isn't the same item.
  let sellQuoteCache = new Map();
  // The GM's own manual-rarity pick for an item with no reference to
  // auto-price from — keyed by item, not check tier. refreshSellInventory
  // rebuilds every row's <select> from scratch on every re-render, so
  // without this the pick would silently revert to blank the next time
  // anything else happened in the shop.
  let manualRaritySelections = new Map();

  container.innerHTML = "";
  const wrap = el("div", "d-flex flex-column gap-2");
  container.appendChild(wrap);

  // --- Header: which shop this card shows -----------------------------------
  const locationSelect = document.createElement("select");
  locationSelect.className = "form-select form-select-sm";
  locationSelect.style.maxWidth = "12rem";
  setHeaderContent?.(locationSelect);

  const noShopsNotice = el(
    "div",
    "text-body-secondary small",
    "No Locations are tagged with the Shop Feature yet — add it to one in Sanctum first."
  );
  setElementVisible(noShopsNotice, false);

  // --- GM: Open Shop (currency mode + optional treasury) --------------------
  const openForm = el("div", "d-flex flex-column gap-2 border rounded p-2");
  openForm.appendChild(el("div", "small fw-semibold", "Open this shop"));
  const currencyModeRow = el("div", "d-flex align-items-center gap-2");
  currencyModeRow.appendChild(el("span", "small text-body-secondary flex-grow-1", "Who pays for purchases"));
  const currencyModeSelect = document.createElement("select");
  currencyModeSelect.className = "form-select form-select-sm";
  currencyModeSelect.style.maxWidth = "10rem";
  [
    ["personal", "Each buyer"],
    ["party", "Party wallet"],
  ].forEach(([value, label]) => {
    const option = document.createElement("option");
    option.value = value;
    option.textContent = label;
    currencyModeSelect.appendChild(option);
  });
  currencyModeRow.appendChild(currencyModeSelect);
  const treasuryRow = el("div", "d-flex align-items-center gap-2");
  treasuryRow.appendChild(el("span", "small text-body-secondary flex-grow-1", "Shop's own funds (optional)"));
  const treasuryAmountInput = document.createElement("input");
  treasuryAmountInput.type = "number";
  treasuryAmountInput.min = "0";
  treasuryAmountInput.className = "form-control form-control-sm";
  treasuryAmountInput.style.maxWidth = "6rem";
  treasuryAmountInput.placeholder = "Unlimited";
  const treasuryDenomInput = document.createElement("input");
  treasuryDenomInput.type = "text";
  treasuryDenomInput.className = "form-control form-control-sm";
  treasuryDenomInput.style.maxWidth = "4rem";
  treasuryDenomInput.value = "gp";
  treasuryRow.append(treasuryAmountInput, treasuryDenomInput);
  const openButton = el("button", "btn btn-primary btn-sm align-self-start", "Open Shop");
  openButton.type = "button";
  openForm.append(currencyModeRow, treasuryRow, openButton);

  // --- Status row (everyone) + GM Close ---------------------------------
  const statusRow = el("div", "d-flex align-items-center gap-2 flex-wrap");
  const statusLabel = el("span", "small text-body-secondary flex-grow-1", "Shop closed.");
  const closeButton = el("button", "btn btn-outline-secondary btn-sm", "Close Shop");
  closeButton.type = "button";
  statusRow.append(statusLabel, closeButton);

  // --- PC's check (GM-only, applies to both Buy and Sell) --------------
  // One shared pick, not per-item. GM-only, same gate as "Buying for"/
  // "Selling as" — letting a player freely dial their own discount up with
  // no oversight defeats the point of it being a roll at all.
  const checkTierRow = el("div", "d-flex align-items-center gap-2");
  checkTierRow.appendChild(el("span", "small text-body-secondary flex-grow-1", "PC's check"));
  const checkTierSelect = document.createElement("select");
  checkTierSelect.className = "form-select form-select-sm";
  checkTierSelect.style.maxWidth = "10rem";
  PRICE_CHECK_TIERS.forEach((tier) => {
    const option = document.createElement("option");
    option.value = tier.id;
    option.textContent = tier.label;
    checkTierSelect.appendChild(option);
  });
  checkTierSelect.value = checkTierId;
  checkTierRow.appendChild(checkTierSelect);
  setElementVisible(checkTierRow, isGm, "flex");
  checkTierSelect.addEventListener("change", () => {
    checkTierId = checkTierSelect.value;
    sellQuoteCache.clear(); // every cached roll used the OLD tier's own multiplier
    renderBuyItems();
    void refreshSellInventory();
  });

  // --- Buy panel ------------------------------------------------------------
  const buySection = el("div", "d-flex flex-column gap-2");
  buySection.appendChild(el("div", "small fw-semibold", "For sale"));
  const buyForRow = el("div", "d-flex align-items-center gap-2");
  buyForRow.appendChild(el("span", "small text-body-secondary flex-grow-1", "Buying for"));
  const buyForSelect = document.createElement("select");
  buyForSelect.className = "form-select form-select-sm";
  buyForSelect.style.maxWidth = "12rem";
  buyForRow.appendChild(buyForSelect);
  setElementVisible(buyForRow, isGm, "flex");
  // The resolved buyer's own current currency — under the select for a GM
  // (whoever "Buying for" currently resolves to), or a plain always-shown
  // line for a non-GM viewer (who has no picker, just their own character).
  const buyerCurrencyLine = el("div", "small text-body-secondary");
  const buyItemsWrap = el("div", "d-flex flex-column gap-2");
  const buyEmptyNotice = el("div", "text-body-secondary small", "Nothing in stock.");
  buySection.append(buyForRow, buyerCurrencyLine, buyItemsWrap, buyEmptyNotice);

  // --- Sell panel -------------------------------------------------------
  const sellSection = el("div", "d-flex flex-column gap-2");
  sellSection.appendChild(el("div", "small fw-semibold", "Sell"));
  const sellAsRow = el("div", "d-flex align-items-center gap-2");
  sellAsRow.appendChild(el("span", "small text-body-secondary flex-grow-1", "Selling as"));
  const sellAsSelect = document.createElement("select");
  sellAsSelect.className = "form-select form-select-sm";
  sellAsSelect.style.maxWidth = "12rem";
  sellAsRow.appendChild(sellAsSelect);
  setElementVisible(sellAsRow, isGm, "flex");
  const sellItemsWrap = el("div", "d-flex flex-column gap-2");
  const sellEmptyNotice = el("div", "text-body-secondary small", "Nothing sellable.");
  sellSection.append(sellAsRow, sellItemsWrap, sellEmptyNotice);

  wrap.append(noShopsNotice, openForm, statusRow, checkTierRow, buySection, sellSection);

  // --- Location picker --------------------------------------------------

  async function loadShopLocations() {
    const entries = await fetchKindEntriesWithIds(dataManager, "location").catch(() => []);
    shopLocations = entries
      .filter((entry) => locationIsShop(entry.entity?.featureIds))
      .map((entry) => ({ id: entry.id, name: entry.entity?.name || entry.id }))
      .sort((a, b) => a.name.localeCompare(b.name));
    locationSelect.innerHTML = "";
    if (!shopLocations.length) {
      setElementVisible(noShopsNotice, true);
      return;
    }
    setElementVisible(noShopsNotice, false);
    const blankOption = document.createElement("option");
    blankOption.value = "";
    blankOption.textContent = "Pick a shop…";
    locationSelect.appendChild(blankOption);
    shopLocations.forEach((location) => {
      const option = document.createElement("option");
      option.value = location.id;
      option.textContent = location.name;
      locationSelect.appendChild(option);
    });
    if (shopLocations.some((location) => location.id === config.followId)) {
      locationSelect.value = config.followId;
    } else if (shopLocations.length === 1) {
      // The common case — auto-selecting the only shop-tagged Location
      // means the GM never has to touch this picker just to add the widget.
      locationSelect.value = shopLocations[0].id;
      persistConfig({ followId: shopLocations[0].id });
    }
  }
  locationSelect.addEventListener("change", () => {
    persistConfig({ followId: locationSelect.value });
    void refreshShopState();
    void refreshVisibility();
  });

  // --- Roster (GM give-to/take-from pickers) -----------------------------

  function populateRosterSelect(selectEl, { includeParty }) {
    const previous = selectEl.value;
    selectEl.innerHTML = "";
    const blankOption = document.createElement("option");
    blankOption.value = "";
    blankOption.textContent = "Pick a recipient…";
    selectEl.appendChild(blankOption);
    if (includeParty) {
      const partyOption = document.createElement("option");
      partyOption.value = "party";
      partyOption.textContent = "The Party";
      selectEl.appendChild(partyOption);
    }
    giveToRoster.forEach((entry) => {
      const option = document.createElement("option");
      option.value = entry.characterId;
      option.textContent = entry.label;
      selectEl.appendChild(option);
    });
    if (Array.from(selectEl.options).some((option) => option.value === previous)) {
      selectEl.value = previous;
    }
  }

  async function loadRoster() {
    if (!isGm || !groupId) return;
    giveToRoster = await resolveGiveToOptions(dataManager, groupId, shareToken).catch(() => []);
  }

  // The active System's own "currency" field (same Array-field convention
  // extractSystemDice/extractSystemRolls use). Shared with
  // shop-transactions.js's own affordability/payment conversion (currency.js)
  // — one loader, not two copies that could drift apart.
  async function loadCurrencyDenominations() {
    const systemId = groupContext?.systemId;
    if (!dataManager || !systemId) return;
    currencyDenominations = await loadSystemCurrencyDenominations(dataManager, systemId);
  }

  // Resolves the {type:"character",characterId,label}|{type:"party"}|null
  // recipient shape buyFromShop/sellToShop expect, from whichever "Buying
  // for"/"Selling as" select is showing — null for a non-GM, always
  // resolving to their own character.
  function resolveRecipient(selectEl) {
    if (!isGm) return null;
    const value = selectEl.value;
    if (!value) return null;
    if (value === "party") return { type: "party" };
    const entry = giveToRoster.find((option) => option.characterId === value);
    return { type: "character", characterId: value, label: entry?.label || value };
  }

  // Mirrors buyFromShop's own payFromParty resolution exactly — an explicit
  // recipient always wins, absent one the shop's default currency mode
  // decides, so the currency line/affordability check always reflects who
  // will actually be charged, never a guess.
  function resolvePayer() {
    const recipient = resolveRecipient(buyForSelect);
    if (recipient?.type === "party") return { type: "party" };
    if (recipient?.type === "character") return { type: "character", characterId: recipient.characterId, label: recipient.label };
    if (!recipient && currentShop?.currency === "party") return { type: "party" };
    return { type: "character", characterId: null }; // self — resolved via ownCharacter below
  }

  function formatCurrencyLine(currency) {
    if (!currency || !currencyDenominations.length) return "";
    return currencyDenominations
      .map((denom) => `${Number(currency[denom.shortName]) || 0} ${denom.shortName}`)
      .join(" · ");
  }

  async function refreshBuyerCurrency() {
    const payer = resolvePayer();
    if (payer.type === "party") {
      buyerCurrency = latestPropertyValues?.currencies || {};
      buyerCurrencyLine.textContent = formatCurrencyLine(buyerCurrency)
        ? `The Party has: ${formatCurrencyLine(buyerCurrency)}`
        : "";
    } else {
      let characterId = payer.characterId;
      if (!characterId) {
        ownCharacter = ownCharacter || (await resolveOwnCharacter(dataManager, groupId, shareToken).catch(() => null));
        characterId = ownCharacter?.id || "";
      }
      if (!characterId) {
        buyerCurrency = null;
        buyerCurrencyLine.textContent = "";
      } else {
        const result = await dataManager.get("character", characterId, { preferLocal: false }).catch(() => null);
        buyerCurrency = result?.payload?.currencies || {};
        const label = payer.label || result?.payload?.name || "";
        buyerCurrencyLine.textContent = formatCurrencyLine(buyerCurrency)
          ? `${label ? `${label} has` : "Has"}: ${formatCurrencyLine(buyerCurrency)}`
          : "";
      }
    }
    renderBuyItems();
  }
  buyForSelect.addEventListener("change", () => void refreshBuyerCurrency());

  // --- Open / Close ----------------------------------------------------

  openButton.addEventListener("click", async () => {
    if (!config.followId || !groupId) return;
    const amount = treasuryAmountInput.value.trim() ? Math.max(0, Number(treasuryAmountInput.value) || 0) : null;
    const treasury = amount !== null ? { amount, denomination: treasuryDenomInput.value.trim() || "gp" } : null;
    openButton.disabled = true;
    try {
      await openShop({
        dataManager,
        groupId,
        locationId: config.followId,
        currency: currencyModeSelect.value === "party" ? "party" : "personal",
        treasury,
      });
      watcher?.noteLocalWrite();
      status?.show("Shop opened.", { type: "success", timeout: 1500 });
      await refreshShopState();
    } catch (error) {
      status?.show(`Unable to open shop: ${error.message}`, { type: "error", timeout: 4000 });
    } finally {
      openButton.disabled = false;
    }
  });

  closeButton.addEventListener("click", async () => {
    if (!config.followId || !groupId) return;
    const persistToLocation = window.confirm("Write the shop's final stock back onto this Location's Assets?");
    closeButton.disabled = true;
    try {
      await closeShop({ dataManager, groupId, locationId: config.followId, persistToLocation });
      watcher?.noteLocalWrite();
      status?.show("Shop closed.", { type: "success", timeout: 1500 });
      await refreshShopState();
    } catch (error) {
      status?.show(`Unable to close shop: ${error.message}`, { type: "error", timeout: 4000 });
    } finally {
      closeButton.disabled = false;
    }
  });

  // --- Buy ----------------------------------------------------------------

  // Mirrors shop-transactions.js's own applyBuyCheckTier exactly — what's
  // shown here is always the exact number buyFromShop will charge, not a
  // separate estimate that could drift from it.
  function applyBuyCheckTierClient(amount) {
    const tier = PRICE_CHECK_TIERS.find((entry) => entry.id === checkTierId) || PRICE_CHECK_TIERS.find((entry) => entry.id === "none");
    return roundPrice(amount * tier.buyMultiplier);
  }

  // Every input this render depends on, in one string — renderAll calls
  // this on every live-sync tick (most of which have nothing to do with
  // this shop), and a full innerHTML rebuild on each one resets scroll
  // position mid-browse. Skipping the rebuild when the signature matches
  // fixes both.
  let lastBuyRenderSignature = null;
  function renderBuyItems() {
    const items = Array.isArray(currentShop?.items) ? currentShop.items : [];
    const signature = JSON.stringify({ items, checkTierId, buyerCurrency, recipient: buyForSelect.value });
    if (signature === lastBuyRenderSignature) return;
    lastBuyRenderSignature = signature;

    disposeTooltips(buyItemsWrap);
    buyItemsWrap.innerHTML = "";
    setElementVisible(buyEmptyNotice, items.length === 0);
    items.forEach((item) => {
      // No flex-wrap — a long item name must never push the row onto a
      // second line; nameWrap (below) is the one thing that shrinks/
      // truncates to make room, everything else (price, stock, Buy) always
      // stays visible on the same line.
      const row = el("div", "d-flex align-items-center gap-2");
      const nameWrap = el("div", "flex-grow-1");
      nameWrap.style.minWidth = "0";
      nameWrap.style.overflow = "hidden";
      nameWrap.style.whiteSpace = "nowrap";
      nameWrap.style.textOverflow = "ellipsis";
      nameWrap.appendChild(createReferenceChip({ kind: item.refKind, id: item.refId, name: item.label, dataManager }));
      row.appendChild(nameWrap);
      // A GM can hand-adjust an already-open item's price directly here —
      // openShop's own rarity/dice-expression roll is only ever a starting
      // suggestion, never permanent. A player sees plain text.
      if (isGm) {
        const priceInput = document.createElement("input");
        priceInput.type = "number";
        priceInput.min = "0";
        priceInput.className = "form-control form-control-sm";
        priceInput.style.width = "5.5rem";
        priceInput.value = String(item.price?.amount ?? 0);
        priceInput.setAttribute("aria-label", `${item.label || item.refId} price`);
        priceInput.addEventListener("click", (event) => event.stopPropagation());
        priceInput.addEventListener("change", async () => {
          const amount = Math.max(0, Math.round(Number(priceInput.value)) || 0);
          try {
            await setShopItemPrice({
              dataManager, groupId, locationId: config.followId, refId: item.refId,
              amount, denomination: item.price?.denomination || "gp",
            });
            watcher?.noteLocalWrite();
            await refreshShopState();
          } catch (error) {
            status?.show(error.message || "Unable to update price.", { type: "error", timeout: 3000 });
          }
        });
        row.appendChild(priceInput);
        row.appendChild(el("span", "small text-body-secondary", item.price?.denomination || "gp"));
        // Only shown once an actual check is selected — at "none" the
        // discounted price equals the listed one, so a second number here
        // would just be visual noise (kept concise per that same rule).
        if (checkTierId !== "none") {
          const discounted = applyBuyCheckTierClient(item.price?.amount || 0);
          row.appendChild(
            el("span", "small text-body-secondary", `→ ${formatPriceAmount(discounted, item.price?.denomination || "gp", currencyDenominations)}`)
          );
        }
      } else {
        const displayAmount = applyBuyCheckTierClient(item.price?.amount || 0);
        row.appendChild(
          el("span", "small text-body-secondary", formatPriceAmount(displayAmount, item.price?.denomination || "gp", currencyDenominations))
        );
      }
      const stockLabel = Number.isFinite(item.stock) ? `${item.stock} in stock` : "In stock";
      row.appendChild(el("span", "small text-body-secondary text-nowrap", stockLabel));
      const buyButton = el("button", "btn btn-outline-primary btn-sm", "Buy");
      buyButton.type = "button";
      const outOfStock = Number.isFinite(item.stock) && item.stock <= 0;
      // buyerCurrency is null while unresolved (still loading, or nobody
      // picked yet) — never blocks the button in that state, only once an
      // actual shortfall is confirmed known. The DISCOUNTED amount — what
      // will actually be charged — not the listed price.
      const amount = applyBuyCheckTierClient(item.price?.amount || 0);
      const denom = item.price?.denomination || "gp";
      // Affordability is about TOTAL VALUE, not this one denomination — a
      // buyer with plenty of silver but no gold could still afford a
      // gold-priced item. Falls back to comparing just this denomination
      // when the System has no "currency" field to convert with.
      const priceDenoms = currencyDenominations.length ? currencyDenominations : [{ shortName: denom, cost: 1 }];
      const priceBaseUnits = amount * (priceDenoms.find((d) => d.shortName === denom)?.cost || 1);
      const ownedBaseUnits = buyerCurrency ? currencyToBaseUnits(buyerCurrency, priceDenoms) : null;
      const canAfford = ownedBaseUnits == null || ownedBaseUnits >= priceBaseUnits;
      const noRecipientPicked = isGm && !resolveRecipient(buyForSelect);
      const disabledReason = outOfStock
        ? "Out of stock."
        : noRecipientPicked
          ? "Pick who this purchase is for first."
          : !canAfford
            ? `Not enough funds — short ${Object.entries(baseUnitsToPriceBreakdown(priceBaseUnits - ownedBaseUnits, priceDenoms))
                .map(([short, amt]) => `${amt} ${short}`)
                .join(", ")}.`
            : "";
      buyButton.addEventListener("click", async () => {
        const recipient = resolveRecipient(buyForSelect);
        buyButton.disabled = true;
        try {
          const result = await buyFromShop({
            dataManager, groupId, shareToken, locationId: config.followId, refId: item.refId, recipient, checkTierId,
          });
          watcher?.noteLocalWrite();
          status?.show(`Bought ${result.label} for ${formatPriceAmount(result.price, result.denomination, currencyDenominations)}.`, {
            type: "success",
            timeout: 2000,
          });
          await refreshShopState();
          await refreshBuyerCurrency();
          if (sellTargetCharacterId) void refreshSellInventory();
        } catch (error) {
          status?.show(error.message, { type: "error", timeout: 4000 });
          buyButton.disabled = false;
        }
      });
      // buyButton needs a real parent before setDisabledTooltip can
      // correctly insert its wrapper — append to `row` first.
      row.appendChild(buyButton);
      setDisabledTooltip(buyButton, disabledReason);
      buyItemsWrap.appendChild(row);
    });
    refreshTooltips(buyItemsWrap);
  }

  // --- Sell ------------------------------------------------------------

  async function resolveSellTargetCharacterId() {
    if (!isGm) {
      ownCharacter = ownCharacter || (await resolveOwnCharacter(dataManager, groupId, shareToken).catch(() => null));
      return ownCharacter?.id || "";
    }
    return sellAsSelect.value || "";
  }

  function sellQuoteCacheKey(item, manualRarityId) {
    return `${sellTargetCharacterId}::${item.refId || item.name}::${checkTierId}::${manualRarityId || ""}`;
  }

  // Resolves (from cache, or a fresh quoteSaleToShop call) and displays the
  // EXACT price this item would sell for right now — never a range. Cached
  // by (seller, item, check tier, manual rarity) so it stays stable across
  // frequent re-renders, only rolling again when one of those changes.
  // `wrap` is the Sell button's persistent tooltip-trigger wrapper, so a
  // later re-resolve can toggle the tooltip without re-parenting the
  // button — priceDisplay stays short with the actual reason in the
  // tooltip instead.
  // Sets the Sell button's disabled/tooltip state directly, no quote
  // involved — for the two cases known up front (nothing sellable in this
  // System, or a non-GM viewer who can't pick a rarity anyway).
  function setSellUnresolved(priceDisplay, sellButton, wrap, reason) {
    priceDisplay.textContent = "—";
    setDisabledTooltip(sellButton, reason, { wrapper: wrap });
  }

  async function resolveAndShowSellQuote(index, item, manualRarityId, priceDisplay, sellButton, wrap) {
    const cacheKey = sellQuoteCacheKey(item, manualRarityId);
    let quote = sellQuoteCache.get(cacheKey);
    if (!quote) {
      try {
        quote = await quoteSaleToShop({
          dataManager, groupId, locationId: config.followId,
          sellerCharacterId: sellTargetCharacterId, inventoryIndex: index, manualRarityId, checkTierId,
        });
        sellQuoteCache.set(cacheKey, quote);
      } catch (error) {
        // Always the real thrown reason, never a generic placeholder — a
        // referenced item has no picker to fall back on, so without this a
        // failed auto-price (e.g. rarity data misplaced on the record) gave
        // no way to tell what actually went wrong.
        setSellUnresolved(priceDisplay, sellButton, wrap, error.message);
        return;
      }
    }
    priceDisplay.textContent = formatPriceAmount(quote.price, quote.denomination, currencyDenominations);
    setDisabledTooltip(sellButton, "", { wrapper: wrap });
  }

  // Same signature-skip reasoning as renderBuyItems' own
  // lastBuyRenderSignature — the fetch still has to happen, but the DOM
  // rebuild (and its scroll-reset) is skipped once the fetch confirms
  // nothing relevant to display actually changed.
  let lastSellRenderSignature = null;
  async function refreshSellInventory() {
    sellTargetCharacterId = await resolveSellTargetCharacterId();
    if (!sellTargetCharacterId) {
      lastSellRenderSignature = null;
      disposeTooltips(sellItemsWrap);
      sellItemsWrap.innerHTML = "";
      setElementVisible(sellEmptyNotice, true);
      sellEmptyNotice.textContent = isGm ? "Pick whose inventory to sell from." : "You don't have a character in this campaign.";
      return;
    }
    const result = await dataManager.get("character", sellTargetCharacterId, { preferLocal: false }).catch(() => null);
    const freshInventory = Array.isArray(result?.payload?.inventory) ? result.payload.inventory : [];
    const signature = JSON.stringify({ sellTargetCharacterId, checkTierId, freshInventory });
    if (signature === lastSellRenderSignature) return;
    lastSellRenderSignature = signature;
    sellInventory = freshInventory;

    disposeTooltips(sellItemsWrap);
    sellItemsWrap.innerHTML = "";
    setElementVisible(sellEmptyNotice, sellInventory.length === 0);
    sellEmptyNotice.textContent = "Nothing sellable.";
    sellInventory.forEach((item, index) => {
      // No flex-wrap — same reasoning as the Buy panel's own rows: a long
      // item name must never push the row onto a second line.
      const row = el("div", "d-flex align-items-center gap-2");
      const isReferenced = item.refKind === "wonder" && Boolean(item.refId);
      const nameWrap = el("div", "d-flex align-items-center gap-2 flex-grow-1");
      nameWrap.style.minWidth = "0";
      nameWrap.style.overflow = "hidden";
      nameWrap.style.whiteSpace = "nowrap";
      nameWrap.style.textOverflow = "ellipsis";
      if (isReferenced) {
        nameWrap.appendChild(createReferenceChip({ kind: item.refKind, id: item.refId, name: item.name, dataManager }));
        if (item.quantity > 1) nameWrap.appendChild(el("span", "small text-body-secondary", `×${item.quantity}`));
      } else {
        nameWrap.appendChild(el("span", "", item.quantity > 1 ? `${item.name} ×${item.quantity}` : item.name));
      }
      row.appendChild(nameWrap);

      const manualRarityKey = `${sellTargetCharacterId}::${item.refId || item.name}`;
      const rarityFallback = document.createElement("select");
      rarityFallback.className = "form-select form-select-sm";
      rarityFallback.style.maxWidth = "9rem";
      rarityFallback.setAttribute("data-bs-toggle", "tooltip");
      rarityFallback.setAttribute("data-bs-title", "Rarity (only used if this item can't be auto-priced)");
      const blankRarity = document.createElement("option");
      blankRarity.value = "";
      blankRarity.textContent = "Pick a rarity…";
      rarityFallback.appendChild(blankRarity);
      rarityRanges.forEach((range) => {
        const option = document.createElement("option");
        option.value = range.id;
        option.textContent = range.name;
        rarityFallback.appendChild(option);
      });
      // Restores the GM's own prior pick for THIS item — refreshSellInventory
      // rebuilds this <select> from scratch on every re-render, so without
      // this it would silently revert to blank on any unrelated shop change.
      const restoredRarityId = manualRaritySelections.get(manualRarityKey) || "";
      if (restoredRarityId && rarityRanges.some((range) => range.id === restoredRarityId)) {
        rarityFallback.value = restoredRarityId;
      }
      setElementVisible(rarityFallback, !isReferenced && isGm && rarityRanges.length > 0, "inline-block");
      row.appendChild(rarityFallback);

      // The EXACT price (a real roll, not a range) — resolved and cached
      // by resolveAndShowSellQuote, never re-rolled just from a re-render.
      // Kept short — the reason it's unresolved lives in the Sell button's
      // own tooltip instead (see setSellUnresolved).
      const priceDisplay = el("span", "small text-body-secondary text-nowrap", "—");
      row.appendChild(priceDisplay);
      const sellButton = el("button", "btn btn-outline-secondary btn-sm", "Sell");
      sellButton.type = "button";
      sellButton.disabled = true;
      // setDisabledTooltip's `wrapper` option takes this wrapper as-is
      // instead of auto-creating/removing its own — kept always present so
      // a later re-resolve can toggle the tooltip without re-parenting.
      const sellButtonWrap = el("span", "d-inline-block");
      sellButtonWrap.tabIndex = 0;
      sellButtonWrap.appendChild(sellButton);
      row.appendChild(sellButtonWrap);
      sellItemsWrap.appendChild(row);

      rarityFallback.addEventListener("change", () => {
        const picked = rarityFallback.value || "";
        if (picked) manualRaritySelections.set(manualRarityKey, picked);
        else manualRaritySelections.delete(manualRarityKey);
        void resolveAndShowSellQuote(index, item, picked || null, priceDisplay, sellButton, sellButtonWrap);
      });
      if (isReferenced) {
        void resolveAndShowSellQuote(index, item, null, priceDisplay, sellButton, sellButtonWrap);
      } else if (!rarityRanges.length) {
        setSellUnresolved(priceDisplay, sellButton, sellButtonWrap, "Not sellable — this System has no rarity data.");
      } else if (!isGm) {
        setSellUnresolved(priceDisplay, sellButton, sellButtonWrap, "Ask your GM to price this by rarity.");
      } else if (restoredRarityId) {
        void resolveAndShowSellQuote(index, item, restoredRarityId, priceDisplay, sellButton, sellButtonWrap);
      } else {
        setSellUnresolved(priceDisplay, sellButton, sellButtonWrap, "Pick a rarity to price this.");
      }

      sellButton.addEventListener("click", async () => {
        const manualRarityId = rarityFallback.value || null;
        const quote = sellQuoteCache.get(sellQuoteCacheKey(item, manualRarityId));
        if (!quote) return; // shouldn't happen — the button is disabled until a quote exists
        sellButton.disabled = true;
        try {
          // "Sell" only ever moves ONE unit — a stack of 10 Rations needs
          // that spelled out explicitly, and offers "Sell All" as a genuine
          // third choice rather than clicking Sell ten times. Only shown
          // once there's more than one to sell.
          const ownedQuantity = Number.isFinite(item.quantity) ? item.quantity : 1;
          const unitPriceText = formatPriceAmount(quote.price, quote.denomination, currencyDenominations);
          const bodyHtml =
            ownedQuantity > 1
              ? `<p>Sell <strong>1</strong> of your ${ownedQuantity} <strong>${quote.label}</strong> for <strong>${unitPriceText}</strong>?</p>
                 <p class="small text-body-secondary mb-0">Use "Sell All" to sell all ${ownedQuantity} at once for <strong>${formatPriceTotal(
                  quote.price,
                  ownedQuantity,
                  quote.denomination,
                  currencyDenominations
                )}</strong> total.</p>`
              : `<p>Sell <strong>${quote.label}</strong> for <strong>${unitPriceText}</strong>?</p>`;
          const confirmed = await showConfirmModal({
            title: "Sell this item?",
            bodyHtml,
            confirmLabel: ownedQuantity > 1 ? "Sell 1" : "Sell",
            cancelLabel: "Cancel",
            confirmVariant: "primary",
            extraLabel: ownedQuantity > 1 ? `Sell All (${ownedQuantity})` : "",
            extraVariant: "primary",
          });
          if (!confirmed) {
            sellButton.disabled = false;
            return;
          }
          const sellQuantity = confirmed === "extra" ? ownedQuantity : 1;
          const result = await sellToShop({
            dataManager, groupId, shareToken, locationId: config.followId,
            sellerCharacterId: sellTargetCharacterId, inventoryIndex: index, quote, quantity: sellQuantity,
          });
          watcher?.noteLocalWrite();
          sellQuoteCache.delete(sellQuoteCacheKey(item, manualRarityId));
          const soldLabel = result.quantity > 1 ? `${result.quantity} × ${result.label}` : result.label;
          status?.show(`Sold ${soldLabel} for ${formatPriceAmount(result.totalPrice, result.denomination, currencyDenominations)}.`, {
            type: "success",
            timeout: 2000,
          });
          await refreshShopState();
          await refreshSellInventory();
        } catch (error) {
          status?.show(error.message, { type: "error", timeout: 4000 });
          sellButton.disabled = false;
        }
      });
    });
    refreshTooltips(sellItemsWrap);
  }
  sellAsSelect.addEventListener("change", () => {
    // Not strictly required for correctness (both Maps are already keyed
    // by sellTargetCharacterId) — just avoids unbounded growth across a
    // long session of switching between many sellers.
    sellQuoteCache.clear();
    manualRaritySelections.clear();
    void refreshSellInventory();
  });

  // --- Whole-widget render ------------------------------------------------

  function renderAll() {
    const hasLocation = Boolean(config.followId);
    const isOpen = Boolean(currentShop && Array.isArray(currentShop.items));
    setElementVisible(openForm, hasLocation && isGm && !isOpen, "flex");
    setElementVisible(statusRow, hasLocation, "flex");
    setElementVisible(checkTierRow, hasLocation && isOpen && isGm, "flex");
    setElementVisible(buySection, hasLocation && isOpen, "flex");
    setElementVisible(sellSection, hasLocation && isOpen, "flex");
    closeButton.disabled = !isOpen;
    setElementVisible(closeButton, isOpen && isGm, "inline-block");
    if (!hasLocation) {
      statusLabel.textContent = "";
    } else if (isOpen) {
      const itemCount = currentShop.items.length;
      const treasuryText = currentShop.treasury
        ? ` — ${formatPrice(currentShop.treasury)} in the till`
        : "";
      statusLabel.textContent = `Shop open — ${itemCount} item${itemCount === 1 ? "" : "s"} in stock${treasuryText}.`;
    } else {
      statusLabel.textContent = "Shop closed.";
    }
    if (isOpen) {
      setElementVisible(buyForRow, isGm, "flex");
      // The Party is always offered, not only when this shop's default
      // currency mode is "party" — buyFromShop's payFromParty respects an
      // explicit Party pick regardless of the shop's default.
      populateRosterSelect(buyForSelect, { includeParty: true });
      renderBuyItems();
      void refreshBuyerCurrency();
      void refreshSellInventory();
    }
  }

  async function refreshShopState() {
    if (!config.followId || !groupId) {
      currentShop = null;
      latestPropertyValues = {};
      renderAll();
      return;
    }
    const { propertyValues } = await dataManager.getGroupProperties(groupId).catch(() => ({ propertyValues: {} }));
    latestPropertyValues = propertyValues || {};
    currentShop = latestPropertyValues[shopKey()] || null;
    renderAll();
  }

  // --- Show to table (eye icon) -------------------------------------------
  //
  // Same direct spotlightToGroup/clearSpotlight toggle Map's own visibility
  // button uses — the only difference is `contentType`/`kind` is the
  // synthetic "shop" rather than a real Library kind, since a shop isn't
  // its own Library record. Without toggling this, only the GM who
  // manually added this instance can see it at all.
  function updateVisibilityAction() {
    if (!canToggleVisibility) return;
    setRightAction?.({
      icon: visible ? "tabler:eye" : "tabler:eye-off",
      tooltip: visible ? "Showing to table — click to hide" : "Hidden from table — click to show",
      active: visible,
      onClick: () => void toggleVisibility(),
    });
  }

  async function refreshVisibility() {
    if (!canToggleVisibility || !groupId || !config.followId) {
      visible = false;
      updateVisibilityAction();
      return;
    }
    visible = await resolveIsSpotlighted(dataManager, { groupId, shareToken, kind: "shop", id: config.followId });
    updateVisibilityAction();
  }

  async function toggleVisibility() {
    if (!groupId || !config.followId) {
      status?.show("Pick a shop first.", { type: "warning", timeout: 2500 });
      return;
    }
    try {
      if (visible) {
        await dataManager.clearSpotlight({ groupId, kind: "shop", id: config.followId });
        status?.show("Stopped showing to the table.", { type: "success", timeout: 2000 });
      } else {
        // skipShare: true — "shop" isn't a real Library kind (nothing to
        // grant access to; its live state is the campaign Group's own
        // property, already readable by every member), same as every
        // other INLINE_FOLLOW_KINDS widget's spotlightToGroup call.
        await dataManager.spotlightToGroup({ groupId, contentType: "shop", contentId: config.followId, skipShare: true });
        status?.show("Showing to the table.", { type: "success", timeout: 2000 });
      }
    } catch (error) {
      status?.show(error.message || "Unable to update visibility.", { type: "error" });
    }
    await refreshVisibility();
  }

  // --- Live sync ------------------------------------------------------

  const watcher = groupId
    ? watchGroupForChanges({
        dataManager,
        groupId,
        shareToken,
        isOwner: groupContext?.access === "owner",
        onChange: (payload) => {
          if (!config.followId) return;
          latestPropertyValues = payload?.propertyValues || {};
          currentShop = latestPropertyValues[shopKey()] || null;
          renderAll();
        },
      })
    : null;

  async function init() {
    await loadShopLocations();
    await loadRoster();
    if (groupContext?.systemId) {
      rarityRanges = await loadRarityPriceRanges(dataManager, groupContext.systemId).catch(() => []);
    }
    await loadCurrencyDenominations();
    if (isGm) populateRosterSelect(sellAsSelect, { includeParty: false });
    renderAll();
    await refreshShopState();
    await refreshVisibility();
  }
  void init();

  return {
    destroy() {
      setHeaderContent?.(null);
      setRightAction?.(null);
      watcher?.stop();
      disposeTooltips(container);
      container.innerHTML = "";
    },
  };
}
