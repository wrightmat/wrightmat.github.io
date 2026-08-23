// Shared "claim an item out of a map marker's Contents" orchestration —
// the ONE place both Orrery's own authoring view (orrery/js/app.js) and the
// Dashboard's Map widget (widgets/map.js) call into, so the two never grow
// independently-duplicated copies of this logic the way their own
// marker-link popovers already, separately, do (a pre-existing split this
// module deliberately does not try to fix — see orrery/js/lib/map-model.js's
// own createMarkerElement header comment for the full feature reasoning).
//
// Every function here takes its dependencies as explicit parameters, no
// module-level state — same shape common/js/lib/map-live-sync.js's own
// persistElementUpdate/persistMarkerMove already establish, for the same
// reason: usable identically from either caller with zero shared setup.
import { persistElementUpdate } from "./map-live-sync.js";
import { persistGroupPropertyValue } from "./group-live-sync.js";
import { resolveGroupContext } from "./widgets/group-context.js";

// Human-readable "what this entry actually is" label — shared so the GM's
// own Contents list (orrery/js/app.js) and both restricted-viewer claim
// popovers (orrery/js/app.js, widgets/map.js) never describe the same entry
// two different ways. Currency reads as "70 Gold" (amount leads, the way a
// coin count normally reads); anything else reads as "Name ×N" (or just
// "Name" for a single one), matching how the rest of this suite already
// shows a quantity next to a name.
export function describeMarkerContentEntry(entry) {
  if (entry.kind === "currency") {
    return `${entry.quantity} ${entry.name}`;
  }
  return entry.quantity > 1 ? `${entry.name} ×${entry.quantity}` : entry.name;
}

// The Group Property key a container's own "party" claimTarget writes
// into — always literally "inventory" regardless of System, confirmed
// against server/groups.py's own _find_system_inventory_field (which only
// ever matches a System field whose OWN key is "inventory") and
// _GENERIC_INVENTORY_PROPERTY's identical fallback key. A System can change
// what that property's shape/label look like, never what it's keyed as.
const PARTY_INVENTORY_KEY = "inventory";

// The Group Property key a Party Wallet lives under, when a campaign has
// one. A wallet is opt-in per campaign, not a universal default — its mere
// PRESENCE in the group's own `properties` schema (any entry whose `key`
// is this) is what "opts in"; when absent, currency keeps its original,
// unconditional behavior of landing on the claiming player's own Character.
// Value shape mirrors a Character's own `currencies` object exactly
// ({shortName: amount}) on purpose, so the increment logic below is
// identical on either side and the two are trivially interchangeable if a
// GM ever wants to move a balance from the party wallet to a character (or
// back) by hand.
const PARTY_CURRENCY_KEY = "currencies";

// Which Character (if any) the CURRENTLY signed-in user owns as a member of
// `groupId` — reused as-is by claimMarkerContentEntry below, but also
// exported directly since the player-facing claim UI in both callers wants
// to know up front whether a Character-target container is even claimable
// before showing its Claim button as enabled.
//
// Goes through resolveGroupContext (common/js/lib/widgets/group-context.js)
// rather than a raw `dataManager.get("group", groupId)` fetch — confirmed
// real bug this fixes: that raw route returns the group's own STORED file
// as-is, which has no `members` field at all (members is computed
// server-side ONLY for the dedicated /groups/* routes' own serialization —
// see server/groups.py's _serialize_group), so every character-target claim
// silently found zero owned characters and failed, 100% of the time, from
// the moment this feature first shipped. resolveGroupContext resolves
// "whichever campaign is currently ACTIVE" (share token > the header's own
// active-campaign selection), not a targeted lookup by id — trustworthy
// here only because every real caller's own groupId is already sourced from
// that exact same active-campaign signal (Orrery's own
// getActiveCampaignGroupId(), the Map widget's own groupId init option), so
// the two are expected to always agree; the equality check below is a
// cheap, self-correcting guard against the rare case they've diverged,
// rather than trusting that alignment blindly. Returns { id, label } or
// null — no owned character, not authenticated, or the group couldn't be
// resolved.
export async function resolveOwnCharacter(dataManager, groupId, shareToken = "") {
  if (!dataManager || !groupId) return null;
  const userId = dataManager.session?.user?.id ?? null;
  if (userId === null) return null;
  const context = await resolveGroupContext(dataManager, { shareToken }).catch(() => null);
  if (!context || context.groupId !== groupId) return null;
  const members = Array.isArray(context.members) ? context.members : [];
  // First match only — a player who owns more than one Character in the
  // same campaign is rare enough that picking a specific one isn't worth a
  // whole picker UI yet; see this feature's own plan for the full note.
  const owned = members.find((entry) => entry.content_type === "character" && entry.owner_id === userId);
  return owned ? { id: owned.content_id, label: owned.label || owned.content_id } : null;
}

// The full "who could this go to" roster for the active campaign — every
// member's own Character, keyed for a "Give to" picker. Shared by every
// GM override UI in the suite (map-marker claim popovers today; the Shop
// widget's own Buy/Sell "Give to"/"Take from" picker is the next consumer),
// so the roster-building logic only lives once. Deliberately NOT tier-gated
// in here — same convention resolveOwnCharacter/persistGroupPropertyValue
// already follow (plain data resolution, no permission opinion baked in);
// the caller's own UI decides whether to show a picker built from this at
// all (see attachClaimPopover's own dataManager.meetsTier("gm") check).
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
// override (`recipient`, from resolveGiveToOptions above) when given,
// otherwise the acting player's own Character exactly as before — so every
// existing non-GM call site (recipient omitted/null) is byte-for-byte
// unchanged. Bypasses resolveOwnCharacter's own "must be MY OWN character"
// restriction on purpose when a recipient is given: that restriction exists
// to stop a player claiming loot onto someone else's sheet, which is
// precisely the thing a GM override needs to be ABLE to do.
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
// share-link viewer, via the generic full-document route's own
// share_granted check) or a real signed-in session (the member-safe route,
// server/groups.py's get_group_properties — public-only for a non-owner,
// full for the owner/admin). Tried in that order, never both: an
// authenticated claimant with no share token skips the full-document route
// entirely rather than attempting it and catching its guaranteed 401 first
// — confirmed real bug this fixes: every party-target claim (currency OR
// item/Wonder) by a real player who wasn't the campaign's own owner either
// 401'd loudly (the two mid-write reads below, uncaught) or silently
// logged a red network error every time (the wallet-existence check, which
// WAS caught) — same reasoning as group-live-sync.js's own
// watchGroupForChanges. Returns empty if neither access path applies (an
// anonymous viewer with no share token was never going to have group
// access at all, same as before this fix).
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
  // {type:"party"}) — omitted/null for every existing non-GM call site,
  // which reproduces this function's original behavior exactly (the
  // acting player's own Character, or the container/wallet's own default
  // party-vs-character rule). The caller's own UI is responsible for only
  // ever passing one when dataManager.meetsTier("gm") — this function does
  // not itself re-check that, same "trust the caller already gated this"
  // posture the rest of this module already takes.
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
  // Currency's destination is independent of this container's own
  // claimTarget (which only ever governs items/Wonders): it goes to the
  // campaign's Party Wallet if one exists (a Group Property keyed
  // PARTY_CURRENCY_KEY — see that constant's own comment), otherwise it
  // falls back to the claiming player's own Character, exactly as this
  // always behaved before the Party Wallet existed as an option. A GM's
  // own explicit `recipient` — party or a specific character — always wins
  // over both of those defaults; that's the whole point of the override.
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
    // denomination shortName" (the same shape createMarkerContentEntry's
    // own `denomination` field, and this entry's kind:"currency" authoring
    // UI, already commit to) — the denomination was already resolved
    // against the active campaign's own System at author time, so claiming
    // just applies whatever shortName got stamped, the same "trust already-
    // resolved data, don't re-derive" posture persistElementUpdate's own
    // mutator-patch callers already take.
    const denomination = entry.denomination || "";
    claimedLabel = describeMarkerContentEntry(entry);

    if (currencyDestination === "party") {
      // Fresh read right before the write (not the earlier existence-check
      // fetch, which only asked "does a wallet property exist at all" and
      // may be stale by now) — matches the party-inventory branch's own
      // existing fetch-fresh-then-write pattern below.
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
    // notes, weight?}) almost exactly — a "wonder" entry additionally
    // stamps refKind/refId, the same "reference back to source" convention
    // markers already use, so a player can look the full Wonder up again
    // later AND so it renders as the same reference-preview chip
    // component-renderers.js's own renderTextContent/renderInputContent
    // already auto-render for any {refKind,refId,name} value (confirmed
    // real bug, fixed alongside its exact twin in
    // content-feature-matching.js's own linkCharacterInventoryReferences:
    // a bespoke `wonderId` field here was invisible to that mechanism, so a
    // looted Wonder still showed as flat text in the inventory list).
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
