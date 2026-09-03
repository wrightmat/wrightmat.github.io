// Shared "claim an item out of a map marker's Contents" orchestration — the
// one place both Orrery's authoring view and the Dashboard's Map widget call
// into, so the two never grow independently-duplicated copies of this logic.
//
// Every function here takes its dependencies as explicit parameters, no
// module-level state, same shape map-live-sync.js's persistElementUpdate
// establishes — usable identically from either caller with zero shared setup.
import { persistElementUpdate } from "./map-live-sync.js";
import { persistGroupPropertyValue } from "./group-live-sync.js";
import { resolveGroupContext } from "./widgets/group-context.js";

// Human-readable "what this entry actually is" label, shared so the GM's
// Contents list and both restricted-viewer claim popovers never describe
// the same entry two different ways. Currency reads as "70 Gold" (amount
// leads); anything else reads as "Name ×N" (or just "Name" for one).
export function describeMarkerContentEntry(entry) {
  if (entry.kind === "currency") {
    return `${entry.quantity} ${entry.name}`;
  }
  return entry.quantity > 1 ? `${entry.name} ×${entry.quantity}` : entry.name;
}

// The Group Property key a container's "party" claimTarget writes into —
// always literally "inventory" regardless of System (matches
// server/groups.py's _find_system_inventory_field/_GENERIC_INVENTORY_PROPERTY).
const PARTY_INVENTORY_KEY = "inventory";

// The Group Property key a Party Wallet lives under, when a campaign has
// one. Opt-in per campaign — its mere presence in the group's `properties`
// schema is what "opts in"; when absent, currency lands on the claiming
// player's own Character. Value shape mirrors a Character's `currencies`
// object exactly ({shortName: amount}) so the increment logic is identical
// on either side and a GM can move a balance between them by hand.
const PARTY_CURRENCY_KEY = "currencies";

// Which Character (if any) the currently signed-in user owns as a member of
// `groupId` — reused by claimMarkerContentEntry below, and exported
// directly since the player-facing claim UI wants to know up front whether
// a Character-target container is even claimable before enabling its Claim
// button.
//
// Goes through resolveGroupContext rather than a raw `dataManager.get
// ("group", groupId)` fetch — that raw route returns the group's stored
// file as-is, which has no `members` field at all (members is computed
// server-side only for the dedicated /groups/* routes). resolveGroupContext
// resolves "whichever campaign is currently active", not a targeted lookup
// by id — trustworthy here because every real caller's groupId is already
// sourced from that same active-campaign signal, so the equality check
// below is a cheap self-correcting guard against the rare case they've
// diverged. Returns { id, label } or null.
export async function resolveOwnCharacter(dataManager, groupId, shareToken = "") {
  if (!dataManager || !groupId) return null;
  const userId = dataManager.session?.user?.id ?? null;
  if (userId === null) return null;
  const context = await resolveGroupContext(dataManager, { shareToken }).catch(() => null);
  if (!context || context.groupId !== groupId) return null;
  const members = Array.isArray(context.members) ? context.members : [];
  // First match only — a player owning more than one Character in the same
  // campaign is rare enough that picking a specific one isn't worth a
  // picker UI yet.
  const owned = members.find((entry) => entry.content_type === "character" && entry.owner_id === userId);
  return owned ? { id: owned.content_id, label: owned.label || owned.content_id } : null;
}

// The full "who could this go to" roster for the active campaign — every
// member's Character, keyed for a "Give to" picker. Shared by every GM
// override UI in the suite so the roster-building logic only lives once.
// Deliberately NOT tier-gated here, same convention resolveOwnCharacter
// follows (plain data resolution, no permission opinion baked in) — the
// caller's UI decides whether to show a picker built from this at all.
export async function resolveGiveToOptions(dataManager, groupId, shareToken = "") {
  if (!dataManager || !groupId) return [];
  const context = await resolveGroupContext(dataManager, { shareToken }).catch(() => null);
  if (!context || context.groupId !== groupId) return [];
  const members = Array.isArray(context.members) ? context.members : [];
  return members
    .filter((entry) => entry.content_type === "character")
    .map((entry) => ({ type: "character", characterId: entry.content_id, label: entry.label || entry.content_id }));
}

// Resolves the Character a claim/purchase should land on: an explicit GM
// override (`recipient`) when given, otherwise the acting player's own
// Character as before. Bypasses resolveOwnCharacter's "must be MY OWN
// character" restriction on purpose when a recipient is given — that
// restriction exists to stop a player claiming loot onto someone else's
// sheet, exactly what a GM override needs to be able to do.
async function resolveClaimCharacter(dataManager, groupId, shareToken, recipient) {
  if (recipient?.type === "character" && recipient.characterId) {
    const result = await dataManager.get("character", recipient.characterId, { preferLocal: false }).catch(() => null);
    if (!result?.payload) return null;
    return { id: recipient.characterId, label: recipient.label || result.payload.name || recipient.characterId };
  }
  return resolveOwnCharacter(dataManager, groupId, shareToken);
}

// A Group's properties/propertyValues, resolved via whichever route this
// caller actually has access through — a share token (an anonymous
// share-link viewer) or a real signed-in session (the member-safe route,
// public-only for a non-owner, full for the owner/admin). Tried in that
// order, never both: an authenticated claimant with no share token skips
// the full-document route entirely rather than attempting it and catching
// its guaranteed 401 first. Returns empty if neither access path applies.
async function fetchGroupProperties(dataManager, groupId, shareToken) {
  if (shareToken) {
    const result = await dataManager.get("group", groupId, { shareToken, preferLocal: false });
    return { properties: result?.payload?.properties || [], propertyValues: result?.payload?.propertyValues || {} };
  }
  if (dataManager.isAuthenticated?.()) {
    const result = await dataManager.getGroupProperties(groupId);
    return { properties: result?.properties || [], propertyValues: result?.propertyValues || {} };
  }
  return { properties: [], propertyValues: {} };
}

// Claims ONE ContentEntry (map-model.js's own createMarkerContentEntry
// shape) off a marker's `contents`, delivering it to whichever destination
// the container's own `claimTarget` names, and posts a Game Log entry.
//
// Character resolution happens BEFORE anything is removed from the map —
// a player with no owned Character in this campaign, or no active
// campaign at all, gets a clear error and the item stays right where it
// was, still claimable once that's no longer true. The map-side removal
// itself re-reads the element fresh (persistElementUpdate's own contract)
// and is a safe no-op if another player already claimed the same entry in
// the meantime — this function returns null in that case rather than
// throwing, so the caller can show "already claimed" instead of an error.
export async function claimMarkerContentEntry({
  dataManager, groupId, shareToken = "", mapId, layerId, elementId, contentId,
  // GM-only override (build via resolveGiveToOptions above, or
  // {type:"party"}) — omitted/null for every non-GM call site, reproducing
  // this function's original behavior exactly. The caller's UI is
  // responsible for only passing one when dataManager.meetsTier("gm") —
  // this function doesn't re-check that itself.
  recipient = null,
}) {
  if (!dataManager || !mapId || !layerId || !elementId || !contentId) {
    throw new Error("Missing required claim parameters.");
  }
  const mapResult = await dataManager.get("map", mapId, { shareToken, preferLocal: false });
  const element = mapResult?.payload?.layers
    ?.find((entry) => entry.id === layerId)
    ?.elements?.find((entry) => entry.id === elementId);
  const contents = Array.isArray(element?.contents) ? element.contents : [];
  const entry = contents.find((item) => item.id === contentId);
  if (!entry) {
    return null; // already claimed by someone else, or the container's own contents changed
  }
  // Currency's destination is independent of this container's claimTarget
  // (which only governs items/Wonders): it goes to the campaign's Party
  // Wallet if one exists, otherwise falls back to the claiming player's own
  // Character. A GM's explicit `recipient` always wins over both defaults.
  const isCurrency = entry.kind === "currency";
  const claimTarget =
    recipient?.type === "party" ? "party" : recipient?.type === "character" ? "character" : element.claimTarget === "party" ? "party" : "character";
  const markerLabel = element.label || "";

  let character = null;
  let currencyDestination = null; // "party" | "character" — only meaningful when isCurrency
  if (isCurrency) {
    if (!groupId) {
      throw new Error("No active campaign to claim this into.");
    }
    if (recipient?.type === "party") {
      currencyDestination = "party";
    } else if (recipient?.type === "character") {
      currencyDestination = "character";
      character = await resolveClaimCharacter(dataManager, groupId, shareToken, recipient);
      if (!character) {
        throw new Error("Couldn't find that character.");
      }
    } else {
      const { properties } = await fetchGroupProperties(dataManager, groupId, shareToken).catch(() => ({ properties: [] }));
      const hasPartyWallet = properties.some((property) => property?.key === PARTY_CURRENCY_KEY);
      if (hasPartyWallet) {
        currencyDestination = "party";
      } else {
        currencyDestination = "character";
        character = await resolveOwnCharacter(dataManager, groupId, shareToken);
        if (!character) {
          throw new Error("You don't have a character in this campaign to claim currency with.");
        }
      }
    }
  } else if (claimTarget === "character") {
    if (!groupId) {
      throw new Error("No active campaign to claim this into.");
    }
    character = await resolveClaimCharacter(dataManager, groupId, shareToken, recipient);
    if (!character) {
      throw new Error("You don't have a character in this campaign to claim items with.");
    }
  } else if (!groupId) {
    throw new Error("No active campaign to claim this into.");
  }

  // Only now does anything actually get removed from the map — everything
  // above either resolved successfully or already threw, so the loot is
  // never destroyed by a claim that couldn't actually be delivered.
  const freshMap = await persistElementUpdate({
    dataManager,
    mapId,
    shareToken,
    layerId,
    elementId,
    patch: (freshElement) => {
      const freshContents = Array.isArray(freshElement.contents) ? freshElement.contents : [];
      freshElement.contents = freshContents.filter((item) => item.id !== contentId);
    },
  });
  if (!freshMap) {
    return null; // the element itself vanished between the two reads above
  }

  let destinationLabel;
  let claimedLabel;
  if (isCurrency) {
    // No System-shape assumption made here beyond "an object keyed by
    // denomination shortName" — the denomination was already resolved
    // against the active campaign's System at author time, so claiming
    // just applies whatever shortName got stamped.
    const denomination = entry.denomination || "";
    claimedLabel = describeMarkerContentEntry(entry);

    if (currencyDestination === "party") {
      // Fresh read right before the write, not the earlier existence-check
      // fetch (which only asked "does a wallet property exist" and may be
      // stale by now).
      const { propertyValues } = await fetchGroupProperties(dataManager, groupId, shareToken);
      const currentCurrencies = propertyValues?.[PARTY_CURRENCY_KEY];
      const currencies = currentCurrencies && typeof currentCurrencies === "object" ? currentCurrencies : {};
      await persistGroupPropertyValue({
        dataManager,
        groupId,
        key: PARTY_CURRENCY_KEY,
        value: { ...currencies, [denomination]: (currencies[denomination] || 0) + (entry.quantity || 0) },
      });
      destinationLabel = "the party";
    } else {
      const characterResult = await dataManager.get("character", character.id, { preferLocal: false });
      const freshCharacter = characterResult.payload || {};
      const currencies = freshCharacter.currencies && typeof freshCharacter.currencies === "object" ? freshCharacter.currencies : {};
      freshCharacter.currencies = { ...currencies, [denomination]: (currencies[denomination] || 0) + (entry.quantity || 0) };
      await dataManager.save("character", character.id, freshCharacter);
      destinationLabel = character.label;
    }
  } else {
    // Matches a Character's own real `inventory` shape ({name, quantity,
    // notes, weight?}) — a "wonder" entry additionally stamps refKind/refId
    // so a player can look the full Wonder up again later, and so it
    // renders as the same reference-preview chip renderTextContent already
    // auto-renders for any {refKind,refId,name} value.
    const inventoryItem = { name: entry.name || "Unknown item", quantity: entry.quantity || 1, notes: entry.notes || "" };
    if (Number.isFinite(entry.weight)) inventoryItem.weight = entry.weight;
    if (entry.kind === "wonder" && entry.refId) {
      inventoryItem.refKind = "wonder";
      inventoryItem.refId = entry.refId;
    }
    claimedLabel = describeMarkerContentEntry(entry);

    if (claimTarget === "character") {
      const characterResult = await dataManager.get("character", character.id, { preferLocal: false });
      const freshCharacter = characterResult.payload || {};
      freshCharacter.inventory = [...(Array.isArray(freshCharacter.inventory) ? freshCharacter.inventory : []), inventoryItem];
      await dataManager.save("character", character.id, freshCharacter);
      destinationLabel = character.label;
    } else {
      const { propertyValues } = await fetchGroupProperties(dataManager, groupId, shareToken);
      const currentInventory = Array.isArray(propertyValues?.[PARTY_INVENTORY_KEY]) ? propertyValues[PARTY_INVENTORY_KEY] : [];
      await persistGroupPropertyValue({
        dataManager,
        groupId,
        key: PARTY_INVENTORY_KEY,
        value: [...currentInventory, inventoryItem],
      });
      destinationLabel = "the party";
    }
  }

  // Best-effort — a real, persisted Game Log entry (not the transient
  // ping/broadcast mechanism), but its own failure shouldn't undo an
  // otherwise-successful claim the player already sees reflected on screen.
  void dataManager
    .createGroupLogEntry({
      groupId,
      shareToken,
      type: "message",
      message: `${destinationLabel === "the party" ? "The party" : destinationLabel} looted ${claimedLabel}${markerLabel ? ` from ${markerLabel}` : ""}.`,
    })
    .catch(() => {});

  const destination = isCurrency ? currencyDestination : claimTarget;
  return { entry, label: claimedLabel, destination, destinationLabel, map: freshMap };
}
