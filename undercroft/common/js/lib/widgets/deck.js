// Cards/Decks — the parallel system to System.dice (dice-roll.js's
// extractSystemDice), same reserved-key-on-an-ordinary-Array-field
// convention: a System that wants decks gets a `key: "decks"` Enum-mode
// Array field on `System.fields`, no dedicated Loom UI, each value's `name`
// both id and label, everything else in that value's Extra Properties JSON.
// `cards` is itself an array of face objects — the same precedent as
// Genesys's own symbol-dice `sides` array. A card's `tags` is a free-form
// bag (suit/rank, arcana/suit/rank, whatever a System needs) — never hardcoded field names.

import { persistGroupPropertyValue, watchGroupForChanges } from "../group-live-sync.js";
// resolveActiveDice resolves the active campaign's System DEFINITION
// generically (Group.systemId first, then a character's Assigned Systems)
// — despite its dice-specific name it has no dice knowledge of its own, it's just what extractSystemDice/Decks/Rolls all read from.
import { resolveActiveDice } from "./dice-roll.js";
import { playCardReveal } from "./card-overlay.js";
import { createModeToggleGroup } from "../ui-components.js";
import { refreshTooltips, disposeTooltips } from "../tooltips.js";
import { el, setElementVisible } from "../dom.js";

function randomId() {
  if (typeof crypto !== "undefined" && typeof crypto.randomUUID === "function") {
    return crypto.randomUUID();
  }
  return `${Math.random().toString(16).slice(2)}-${Date.now()}`;
}

export function extractSystemDecks(systemDefinition) {
  const fields = Array.isArray(systemDefinition?.fields) ? systemDefinition.fields : [];
  const decksField = fields.find((field) => field?.type === "array" && field.key === "decks");
  const values = Array.isArray(decksField?.values) ? decksField.values : [];
  return values
    .filter((value) => value && typeof value.name === "string" && value.name && Array.isArray(value.cards) && value.cards.length)
    .map((value) => ({
      id: value.name,
      label: value.name,
      theme: value.theme || "",
      backImage: value.backImage || "",
      cards: value.cards
        .filter((card) => card && typeof card.id === "string" && card.id)
        .map((card) => ({
          id: card.id,
          label: card.label || card.id,
          image: card.image || "",
          tags: card.tags && typeof card.tags === "object" ? card.tags : {},
        })),
    }))
    .filter((deck) => deck.cards.length);
}

// Deck instance state — the one place cards aren't simply "dice with
// pictures" (a die is stateless; a deck has real, shared-across-the-table
// state: which cards remain, what's been discarded). Modeled as a Group
// Property, the same mechanism Party Inventory uses for per-campaign
// mutable shared state — see group-live-sync.js's fetch-fresh/mutate/save
// concurrency reasoning, reused as-is. One property, keyed
// ACTIVE_DECKS_PROPERTY_KEY: an array of {id, deckName, remainingCardIds,
// discardCardIds} — one instance per distinct deck, so a GM can have more than one in play at once.
export const ACTIVE_DECKS_PROPERTY_KEY = "activeDecks";

function buildActiveDecksPropertySchema() {
  return {
    type: "array",
    key: ACTIVE_DECKS_PROPERTY_KEY,
    label: "Active Decks",
    // Same "any party member can write this one property" gate Party
    // Inventory's schema uses — drawing/shuffling is a normal player
    // action, not GM-only (Broadcast/Private visibility is a separate, GM-gated concern layered on top in the widget).
    public: true,
    item: {
      type: "object",
      label: "Deck",
      displayField: `${ACTIVE_DECKS_PROPERTY_KEY}[].deckName`,
      children: [
        { type: "string", key: `${ACTIVE_DECKS_PROPERTY_KEY}[].deckName`, label: "Deck" },
      ],
    },
  };
}

// One-time, self-healing bootstrap — the schema (`properties`) half of a
// Group Property lives separately from its value (`propertyValues`), and
// only a full-document save (owner-only) can add a schema entry. Call this
// from the GM's client before the first draw/shuffle a group ever sees;
// every subsequent draw/shuffle only touches propertyValues via persistGroupPropertyValue.
export async function ensureActiveDecksPropertyOnGroup({ dataManager, groupId, groupPayload }) {
  const properties = Array.isArray(groupPayload?.properties) ? groupPayload.properties : [];
  if (properties.some((prop) => prop?.key === ACTIVE_DECKS_PROPERTY_KEY)) {
    return groupPayload;
  }
  // Re-fetch fresh immediately before the schema write — another GM tab, or
  // this same one, may have already added it in the meantime.
  const fresh = await dataManager.get("group", groupId, { preferLocal: false });
  const freshPayload = fresh?.payload || {};
  const freshProperties = Array.isArray(freshPayload.properties) ? freshPayload.properties : [];
  if (freshProperties.some((prop) => prop?.key === ACTIVE_DECKS_PROPERTY_KEY)) {
    return freshPayload;
  }
  const updated = await dataManager.updateGroup({
    id: groupId,
    properties: [...freshProperties, buildActiveDecksPropertySchema()],
  });
  return updated || freshPayload;
}

export function getActiveDeckInstances(groupPayload) {
  const values = groupPayload?.propertyValues?.[ACTIVE_DECKS_PROPERTY_KEY];
  return Array.isArray(values) ? values.filter((entry) => entry && typeof entry === "object") : [];
}

// A fresh Group read for whichever of properties/propertyValues drawing or
// shuffling needs — but drawing/shuffling is a normal PLAYER action, and
// the generic full-document route only grants a non-owner reader via a
// share token or Character-linked share, which a player using this widget
// from their own Dashboard has neither of. Every draw/shuffle by a real
// player used to 401 here (caught, but still logging a red network-error
// line every click). isOwner is decided by the caller up front rather than attempting the doomed route.
async function fetchGroupPayloadForDeck(dataManager, groupId, isOwner) {
  if (isOwner) {
    const result = await dataManager.get("group", groupId, { preferLocal: false });
    return result?.payload || null;
  }
  const result = await dataManager.getGroupProperties(groupId);
  return { properties: result.properties, propertyValues: result.propertyValues };
}

function shuffledCardIds(deck) {
  const ids = deck.cards.map((card) => card.id);
  for (let i = ids.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [ids[i], ids[j]] = [ids[j], ids[i]];
  }
  return ids;
}

// Pure — resets (or creates) the ONE instance for this deck, full and
// freshly shuffled, empty discard. Kept separate from the persistence
// wrapper below so drawCardsFromInstances can reuse the same "create if missing" shape.
export function shuffleDeckInstances(instances, deck) {
  const existing = instances.find((entry) => entry.deckName === deck.id);
  const fresh = { id: existing?.id || randomId(), deckName: deck.id, remainingCardIds: shuffledCardIds(deck), discardCardIds: [] };
  if (!existing) return [...instances, fresh];
  return instances.map((entry) => (entry === existing ? fresh : entry));
}

// Pure — draws up to `count` cards for this deck in one action (a
// "spread"), auto-creating a fresh shuffled instance first if this table
// has never drawn from it before. Stops early — without auto-reshuffling —
// once the deck runs dry, so `cardIds` can come back shorter than `count`, or empty; check length, not truthiness.
export function drawCardsFromInstances(instances, deck, count = 1) {
  let existing = instances.find((entry) => entry.deckName === deck.id);
  let working = instances;
  if (!existing) {
    existing = { id: randomId(), deckName: deck.id, remainingCardIds: shuffledCardIds(deck), discardCardIds: [] };
    working = [...instances, existing];
  }
  const wantCount = Math.max(1, Math.floor(Number(count)) || 1);
  const cardIds = [];
  let remaining = existing.remainingCardIds;
  let discard = existing.discardCardIds || [];
  for (let i = 0; i < wantCount && remaining.length; i++) {
    const [cardId, ...rest] = remaining;
    cardIds.push(cardId);
    discard = [...discard, cardId];
    remaining = rest;
  }
  const updated = { ...existing, remainingCardIds: remaining, discardCardIds: discard };
  return { instances: working.map((entry) => (entry === existing ? updated : entry)), cardIds };
}

export async function shuffleDeck({ dataManager, groupId, groupPayload, deck, watcher }) {
  const instances = shuffleDeckInstances(getActiveDeckInstances(groupPayload), deck);
  await persistGroupPropertyValue({ dataManager, groupId, key: ACTIVE_DECKS_PROPERTY_KEY, value: instances });
  watcher?.noteLocalWrite();
  return instances;
}

// Returns null if the deck's remaining pile was already empty — otherwise
// up to `count` drawn cards' full records plus the updated instances. A
// single draw is just `count: 1` — everything downstream reads the same `cards` array either way.
export async function drawCards({ dataManager, groupId, groupPayload, deck, count = 1, watcher }) {
  const { instances, cardIds } = drawCardsFromInstances(getActiveDeckInstances(groupPayload), deck, count);
  if (!cardIds.length) return null;
  await persistGroupPropertyValue({ dataManager, groupId, key: ACTIVE_DECKS_PROPERTY_KEY, value: instances });
  watcher?.noteLocalWrite();
  const cards = cardIds.map((cardId) => deck.cards.find((entry) => entry.id === cardId) || { id: cardId, label: cardId });
  return { cards, instances };
}

// --- Deck widget (Dashboard) ---
// Mirrors dice-roller.js structurally: same Default/Broadcast/Private mode
// switcher (Broadcast GM-only), same "shows every deck the active System
// defines" shape Dice Roller uses for a System's own dice. Unlike Dice
// Roller, this widget also tracks shared mutable state (the Active Decks
// Group Property) — watchGroupForChanges keeps remaining/discard counts live for everyone at the table.
export function initDeckWidget(container, { status, dataManager, groupContext = null } = {}) {
  if (!container) {
    return { destroy() {} };
  }

  // Same three-mode shape as dice-roller.js's resolveVisibility (Broadcast
  // GM-only, Private a self-whisper). "Default" means local-only, nothing posted, nothing revealed.
  let mode = "default";
  const currentUserId = dataManager?.session?.user?.id ?? null;
  const isGm = groupContext?.access === "owner";

  function resolveVisibility() {
    if (mode === "private") {
      return { recipientIds: currentUserId != null ? [currentUserId] : undefined, broadcastReveal: false };
    }
    if (mode === "broadcast" && isGm) {
      return { recipientIds: undefined, broadcastReveal: true };
    }
    return { recipientIds: undefined, broadcastReveal: false };
  }

  const modeToggleContainer = el("div");
  function renderModeToggle() {
    createModeToggleGroup({
      container: modeToggleContainer,
      ariaLabel: "Draw visibility",
      value: mode,
      options: [
        { value: "default", label: "Default", icon: "tabler:cards" },
        {
          value: "broadcast",
          label: "Broadcast",
          icon: "tabler:broadcast",
          disabled: !isGm,
          tooltip: isGm ? "Deal this card face-up on everyone's screen" : "GM only",
        },
        { value: "private", label: "Private", icon: "tabler:eye-off", tooltip: "Only you see this draw" },
      ],
      onChange: (next) => {
        mode = next;
        renderModeToggle();
      },
    });
  }

  let systemDecks = [];
  let selectedDeckId = "";
  let groupPayload = null;
  let watcher = null;

  container.innerHTML = "";
  const wrap = el("div", "d-flex flex-column gap-2");
  const emptyMessage = el("p", "text-body-secondary small mb-0", "This System has no decks defined yet.");

  const deckSelect = document.createElement("select");
  deckSelect.className = "form-select form-select-sm";

  // How many cards a single Draw click deals — read fresh at draw time, not tracked separately; the input IS the state.
  const countInput = document.createElement("input");
  countInput.type = "number";
  countInput.min = "1";
  countInput.value = "1";
  countInput.className = "form-control form-control-sm";
  countInput.style.width = "3.5rem";
  countInput.setAttribute("aria-label", "Number of cards to draw");
  countInput.setAttribute("data-bs-toggle", "tooltip");
  countInput.setAttribute("data-bs-title", "Cards to draw");

  const drawButton = el("button", "btn btn-outline-primary btn-sm", "Draw");
  drawButton.type = "button";
  const shuffleButton = el("button", "btn btn-outline-secondary btn-sm", "Shuffle / New Deck");
  shuffleButton.type = "button";
  const buttonRow = el("div", "d-flex gap-2 align-items-center");
  buttonRow.append(countInput, drawButton, shuffleButton);

  const countsLine = el("div", "text-body-secondary small");
  const resultLine = el("div", "small fw-semibold");

  function currentDeck() {
    return systemDecks.find((deck) => deck.id === selectedDeckId) || null;
  }

  function renderCounts() {
    const deck = currentDeck();
    if (!deck) {
      countsLine.textContent = "";
      return;
    }
    const instance = getActiveDeckInstances(groupPayload || {}).find((entry) => entry.deckName === deck.id);
    const remaining = instance ? instance.remainingCardIds.length : deck.cards.length;
    const discarded = instance ? instance.discardCardIds.length : 0;
    countsLine.textContent = `${remaining} remaining · ${discarded} discarded`;
  }

  function renderDeckSelect() {
    deckSelect.innerHTML = "";
    systemDecks.forEach((deck) => {
      const option = document.createElement("option");
      option.value = deck.id;
      option.textContent = deck.label;
      deckSelect.appendChild(option);
    });
    if (!selectedDeckId && systemDecks.length) selectedDeckId = systemDecks[0].id;
    deckSelect.value = selectedDeckId;
    // A single-deck System has nothing to pick between — the dropdown would
    // just be a one-item no-op control taking up space.
    setElementVisible(deckSelect, systemDecks.length > 1, "block");
  }

  deckSelect.addEventListener("change", () => {
    selectedDeckId = deckSelect.value;
    resultLine.textContent = "";
    renderCounts();
  });

  async function ensureGroupWatcher() {
    if (!dataManager || !groupContext?.groupId) return;
    watcher?.stop();
    watcher = watchGroupForChanges({
      dataManager,
      groupId: groupContext.groupId,
      shareToken: groupContext.shareToken || "",
      isOwner: isGm,
      onChange: (payload) => {
        groupPayload = payload;
        renderCounts();
      },
    });
    if (!isGm) return;
    // GM-only, one-time self-healing bootstrap (a full-document schema
    // write). Best-effort: a player drawing before their GM has opened this
    // widget just gets a clear "can't draw yet" error at that point rather than this failing loudly on mount.
    try {
      const fresh = await dataManager.get("group", groupContext.groupId, { preferLocal: false });
      groupPayload = await ensureActiveDecksPropertyOnGroup({
        dataManager,
        groupId: groupContext.groupId,
        groupPayload: fresh?.payload || groupPayload,
      });
      renderCounts();
    } catch (error) {
      // Retried next mount — see comment above.
    }
  }

  async function loadSystemDecks() {
    const systemDefinition = await resolveActiveDice({ dataManager, groupContext }).catch(() => null);
    systemDecks = extractSystemDecks(systemDefinition);
    renderDeckSelect();
    setElementVisible(wrap, systemDecks.length > 0, "flex");
    setElementVisible(emptyMessage, systemDecks.length === 0, "block");
    await ensureGroupWatcher();
    renderCounts();
  }

  async function handleDraw() {
    const deck = currentDeck();
    if (!deck || !dataManager || !groupContext?.groupId) return;
    const count = Math.max(1, Math.floor(Number(countInput.value)) || 1);
    const fresh = await fetchGroupPayloadForDeck(dataManager, groupContext.groupId, isGm).catch(() => null);
    if (fresh) groupPayload = fresh;
    let drawn;
    try {
      drawn = await drawCards({ dataManager, groupId: groupContext.groupId, groupPayload, deck, count, watcher });
    } catch (error) {
      status?.show(error.message || "Unable to draw a card.", { type: "danger" });
      return;
    }
    if (!drawn) {
      status?.show(`${deck.label} is empty — shuffle to reset it.`, { type: "info", timeout: 2500 });
      return;
    }
    if (drawn.cards.length < count) {
      status?.show(`Only ${drawn.cards.length} card${drawn.cards.length === 1 ? "" : "s"} left in ${deck.label}.`, {
        type: "info",
        timeout: 2500,
      });
    }
    groupPayload = {
      ...groupPayload,
      propertyValues: { ...groupPayload.propertyValues, [ACTIVE_DECKS_PROPERTY_KEY]: drawn.instances },
    };
    renderCounts();
    resultLine.textContent = drawn.cards.map((card) => card.label).join(", ");
    const { recipientIds, broadcastReveal } = resolveVisibility();
    const hasRecipients = Array.isArray(recipientIds) && recipientIds.length > 0;
    const cardsPayload = drawn.cards.map((card) => ({ id: card.id, label: card.label, image: card.image || undefined }));
    // `cards` carries every drawn card in order — playCardReveal already staggers however many it's given, no separate multi-card path needed.
    const revealCards = cardsPayload.map((card) => ({ label: card.label, image: card.image || "" }));
    // Plays locally for the drawer on EVERY draw, any mode — matches
    // dice-roll.js's tryOverlayRoll, which always plays the local animation
    // regardless of Default/Broadcast/Private; the mode only ever gates whether OTHER people see it.
    playCardReveal({ cards: revealCards, backImage: deck.backImage || "" });
    if (hasRecipients || broadcastReveal) {
      void dataManager
        .createGroupLogEntry({
          groupId: groupContext.groupId,
          type: "card",
          message: "",
          recipientIds: hasRecipients ? recipientIds : undefined,
          payload: { deckId: deck.id, deckLabel: deck.label, cards: cardsPayload, backImage: deck.backImage || undefined },
        })
        .catch(() => {
          // Best-effort — the draw already succeeded and was reported locally; a failed log post just means nobody else sees it.
        });
    }
    if (broadcastReveal) {
      // Delivered via the same ephemeral, never-persisted channel broadcast
      // dice rolls use — NOT the spotlight mechanism: spotlight is
      // persistent "currently shown to the table" state, so a draw would
      // keep replaying on every later page load until explicitly cleared.
      void dataManager
        .postCardBroadcast({ groupId: groupContext.groupId, deckLabel: deck.label, backImage: deck.backImage || "", cards: revealCards })
        .catch((error) => console.warn("[deck] Broadcast failed", error));
    }
  }
  drawButton.addEventListener("click", () => void handleDraw());

  async function handleShuffle() {
    const deck = currentDeck();
    if (!deck || !dataManager || !groupContext?.groupId) return;
    const fresh = await fetchGroupPayloadForDeck(dataManager, groupContext.groupId, isGm).catch(() => null);
    if (fresh) groupPayload = fresh;
    try {
      const instances = await shuffleDeck({ dataManager, groupId: groupContext.groupId, groupPayload, deck, watcher });
      groupPayload = { ...groupPayload, propertyValues: { ...groupPayload.propertyValues, [ACTIVE_DECKS_PROPERTY_KEY]: instances } };
      renderCounts();
      resultLine.textContent = "";
      status?.show(`${deck.label} shuffled.`, { type: "success", timeout: 1800 });
    } catch (error) {
      status?.show(error.message || "Unable to shuffle that deck.", { type: "danger" });
    }
  }
  shuffleButton.addEventListener("click", () => void handleShuffle());

  renderModeToggle();
  wrap.append(modeToggleContainer, deckSelect, buttonRow, countsLine, resultLine);
  container.append(wrap, emptyMessage);
  setElementVisible(emptyMessage, false, "block");
  refreshTooltips(container);
  void loadSystemDecks();

  return {
    destroy() {
      watcher?.stop();
      disposeTooltips(container);
      container.innerHTML = "";
    },
  };
}

// --- Macro action support (common/js/lib/widgets/macro-runner.js) ---
// `announce` matches DICEROLLER_MACRO_ACTIONS.roll's scope exactly — a
// plain boolean, not the 3-mode switcher above. `count` mirrors the
// widget's own draw-count input, so a macro-triggered draw isn't stuck at one card.

export const DECK_MACRO_ACTIONS = {
  draw: { label: "Draw cards", params: ["deckId", "count", "announce"] },
};

export async function runDeckMacroAction(action, { dataManager, groupContext, status } = {}) {
  const params = action?.params || {};
  const deckId = String(params.deckId || "").trim();
  if (!deckId) {
    throw new Error("No deck given.");
  }
  if (!dataManager || !groupContext?.groupId) {
    throw new Error("No active campaign.");
  }
  const systemDefinition = await resolveActiveDice({ dataManager, groupContext }).catch(() => null);
  const deck = extractSystemDecks(systemDefinition).find((entry) => entry.id === deckId);
  if (!deck) {
    throw new Error(`Unknown deck "${deckId}".`);
  }
  const count = Math.max(1, Math.floor(Number(params.count)) || 1);
  const fresh = await fetchGroupPayloadForDeck(dataManager, groupContext.groupId, groupContext.access === "owner");
  const drawn = await drawCards({ dataManager, groupId: groupContext.groupId, groupPayload: fresh || {}, deck, count });
  if (!drawn) {
    throw new Error(`${deck.label} is empty.`);
  }
  const labels = drawn.cards.map((card) => card.label).join(", ");
  status?.show(`${deck.label}: ${labels}`, { type: "success", timeout: 2600 });
  if (params.announce) {
    await dataManager
      .createGroupLogEntry({
        groupId: groupContext.groupId,
        type: "card",
        message: "",
        payload: {
          deckId: deck.id,
          deckLabel: deck.label,
          cards: drawn.cards.map((card) => ({ id: card.id, label: card.label, image: card.image || undefined })),
          backImage: deck.backImage || undefined,
        },
      })
      .catch(() => {});
  }
}
