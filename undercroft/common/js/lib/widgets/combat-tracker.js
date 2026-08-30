// Combat/initiative tracker — the GM half authors an "encounter" Library
// record (readTier: free, writeTier: gm — see
// undercroft/common/data/kind/encounter.json) and the player half polls it
// read-only. Built as a mountable widget (not a page of its own) because
// combat tracking is party/session-scoped, not character-scoped like
// Workbench's view-switcher, and doesn't belong to any one existing tool —
// see the Dashboard plan this widget was built for.
import { resolveActiveSpotlightId, resolveSpotlightData } from "../spotlight.js";
import { disposeTooltips, refreshTooltips, setDisabledTooltip, initTooltip } from "../tooltips.js";
import { resolveBinding, setAtBinding, findBindingByRole } from "../bindings.js";
import {
  deriveConditionsVocabulary,
  renderTagBadges,
  renderTagDatalist,
  buildTagInputRow,
  applyTagVisibilityState,
} from "./tag-editor.js";
import { connectLiveStream } from "../live.js";
import { el } from "../dom.js";
import { confirmDelete } from "../ownership.js";
import { loadSystemFields, deriveCombatBindings, resolveCombatantStats } from "./combat-bindings.js";
import { uniquifyCombatantName } from "./combatant-naming.js";
import { createReliableInterval } from "../reliable-interval.js";
// The shared dice engine — see dice-roll.js's own identical import path.
// Not rollExpression's overlay/toast wrapper: this rolls potentially many
// non-character combatants' initiative in one Promise.all batch, which a
// single shared 3D overlay canvas isn't designed to show all at once, so
// this stays a plain, silent roll same as before — just no longer its own
// third, independently-duplicated Math.random() implementation.
import { rollDiceExpression } from "../../../../workbench/js/lib/dice.js";
// Cross-tool import into common/ from a specific tool's own js/lib — same
// established pattern map-live-sync.js already uses (createLayer, for the
// exact same reason: reusing the real shape a Map's own data uses rather
// than a hand-rolled second copy). Needed for isCombatantHiddenFromPlayers'
// own write-through to a Map's auto-managed View — see that function's own
// header comment for why "hidden from players" no longer has its own
// separate combatant.hidden field to maintain.
import { createView } from "../../../../orrery/js/lib/map-model.js";

// 5s (was 15s) — a physical second-screen display wants combat to feel
// live, and single-window background polling is now confirmed reliable
// (reliable-interval.js) as long as the window stays genuinely visible.
const POLL_INTERVAL_MS = 5000;

function randomId() {
  if (typeof crypto !== "undefined" && typeof crypto.randomUUID === "function") {
    return crypto.randomUUID();
  }
  return `${Math.random().toString(16).slice(2)}-${Date.now()}`;
}

function debounce(fn, wait) {
  let timer = 0;
  return (...args) => {
    window.clearTimeout(timer);
    timer = window.setTimeout(() => fn(...args), wait);
  };
}

function blankEncounter(name) {
  return {
    id: randomId(),
    name: name || "New Encounter",
    groupId: "",
    systemId: "",
    started: false,
    round: 1,
    activeIndex: 0,
    combatants: [],
  };
}

// loadSystemFields/deriveCombatBindings now live in combat-bindings.js
// (shared with Repository's own `encounter:` block builder) — see that
// module's own comments for what each does.

const REF_KIND_LABELS = { character: "Character", npc: "NPC", monster: "Monster" };
const TAG_DATALIST_ID = "combat-tracker-tag-suggestions";

export function initCombatTrackerWidget(
  container,
  {
    dataManager,
    status,
    mode = "gm",
    groupId = "",
    shareToken = "",
    encounterId = "",
    setRightAction,
    // () => mapId — see ensureActiveMapCached's own comment for the
    // spotlight-first, this-second resolution order. dashboard.js's own
    // caller supplies this (resolving off a live sibling Map widget on the
    // SAME dashboard, findActiveWidgetInstance("map")); omitted entirely in
    // player mode, and gracefully absent in any other caller, since it's
    // purely a "prep before spotlighting" convenience, not something this
    // widget can work without.
    resolveActiveMapId,
  } = {}
) {
  if (!container || !dataManager) {
    return { destroy() {} };
  }

  // GM mode only — see ensureGmShell/renderGm's own comments. Permanent
  // children of `container`, created exactly once and never torn down as
  // elements: `topBarMount` (New Encounter + Encounter select + System
  // select, one row), `toolbarMount` (round readout + start/stop/turn/sort/
  // roll/delete buttons), `listMount` (the combatant list-group — the ONE
  // region that's rebuilt on every render, since it's the only part meant to
  // reflect a poll/sync tick landing while the GM might be mid-edit
  // elsewhere), `editPanelMount` (the selected combatant's own fields),
  // `addRowMount` (the Add Combatant row), and `emptyStateMount` (the "select
  // or create an encounter" message).
  //
  // An earlier attempt only split out addRowMount, leaving every other
  // input (Name/Init/HP/Max HP/Temp HP/AC, the Encounter/System selects)
  // inside one big region that got torn down and rebuilt on EVERY render —
  // including passive ones with nothing to do with whatever the GM was
  // actually typing into (pollActiveEncounter isn't reached in GM mode, but
  // startGmCharacterSync's own periodic re-sync sweep, and simply selecting/
  // editing a DIFFERENT combatant, both trigger a full render()). Splitting
  // just the Add row out reduced the bug to "everywhere except that one
  // row," not eliminated it — confirmed by the user still losing focus in
  // Name/HP/AC while editing. The real fix is the same "never destroy the
  // element" principle applied everywhere it belongs: topBarMount/
  // toolbarMount only rebuild their DOM when the data they depend on
  // (encounter list, system list, started/round) actually changes between
  // renders (see refreshTopBar/refreshToolbar's own signature checks), and
  // editPanelMount only rebuilds when the SELECTED COMBATANT ITSELF changes
  // (see refreshEditPanel) — an unrelated render (a different combatant's
  // HP changing, a poll tick) just pushes fresh values into the existing,
  // still-focused inputs via syncEditPanelValues, skipping whichever one is
  // `document.activeElement` so an in-progress edit is never overwritten out
  // from under the GM. listMount is the deliberate exception: it always
  // rebuilds, since combatant rows have no free-text inputs to lose focus
  // from and are exactly what a GM wants to see update live.
  let topBarMount = null;
  let toolbarMount = null;
  let listMount = null;
  let editPanelMount = null;
  let addRowMount = null;
  let emptyStateMount = null;
  // Cheap "did the inputs to this region actually change since last render"
  // guards — see topBarMount/toolbarMount's own comment above for why.
  let lastTopBarSignature = "";
  let lastToolbarSignature = "";
  // Reference (not deep) equality is enough — state.conditions is only ever
  // reassigned to a NEW array when the System's own condition vocabulary is
  // actually (re)resolved (see the three state.conditions = ... call sites),
  // never as a side effect of a routine poll/sync tick. See renderGm's own
  // renderTagDatalist call for why this matters.
  let lastConditionsRendered = null;
  // {combatantId, panel, nameInput, initInput, hpInput, maxHpInput,
  // tempHpInput, acInput, visibleButton, badgesMount, tagVisibilityButton,
  // tagVisibilityIcon} for whichever combatant editPanelMount currently
  // shows — null when nothing's selected. See refreshEditPanel/
  // syncEditPanelValues.
  let editPanelRefs = null;
  // Ephemeral UI-only state for the Add Tag row's own visibility toggle —
  // whether the NEXT tag added (for whichever combatant is currently
  // selected) should be suppressed from map marker badges. Lives here, not
  // on any combatant, since it's pre-commit state for a row that's shared
  // across whichever single combatant is selected at a time (mirrors
  // visibleButton's own build-once-sync-in-place pattern — see
  // buildEditPanel's own tagVisibilityButton — just without any backing
  // field at all, persisted or otherwise; a "hidden from players" tag is
  // pure per-add UI state the same way, it just happens THAT one's
  // resolved value now lives on Orrery's own Map data instead — see
  // isCombatantHiddenFromPlayers below).
  let pendingTagHidden = false;

  const state = {
    encounter: null,
    conditions: null,
    combatBindings: null,
    ownedEncounters: [],
    pollTimer: 0,
    // GM mode's own safety-net sync sweep (see startGmCharacterSync) — a
    // separate timer from pollTimer above, since the two modes never share
    // an instance and gate on different things (player mode polls the
    // active encounter itself; this re-syncs each PC combatant from its
    // live character record, regardless of whether the live-stream
    // subscription for it actually delivered).
    gmSyncTimer: 0,
    destroyed: false,
    selectedCombatantId: "",
    // Loaded once and cached — renderGm() reads this synchronously so a
    // click-driven re-render never has to await a network fetch before it
    // can rebuild the widget (that gap was the cause of the whole widget
    // visibly flashing empty on every interaction).
    systemsList: null,
    // Same "loaded once, read synchronously on every render" reasoning as
    // systemsList — the Add Combatant row's cascading kind+entity select
    // (renderGmAddCombatantRow) reads this directly rather than
    // re-fetching character/npc/monster lists on every re-render (this
    // widget re-renders on nearly every interaction via markDirty).
    combatantEntityLists: null,
    // Purely a local "is this encounter currently the one shown to the
    // table" indicator for the play/stop button — there's no backend
    // "unspotlight" call to revoke a broadcast, so "stop" just resets this
    // local flag rather than undoing anything server-side.
    announced: false,
  };

  // "Visible to players" no longer has its own combatant.hidden field —
  // it's derived live from whichever marker on the campaign's own currently
  // active/spotlighted MAP represents this combatant, the same "read live
  // from the other tool's own record, don't keep a shadow copy" precedent
  // resolveMarkerConditionIcons already established for a marker reading a
  // Character's own conditions (map-viewer.js). Here the direction is
  // reversed — Combat Tracker reads FROM Orrery's own Map/View data,
  // instead of Orrery reading from Combat Tracker's combatant.conditions —
  // but it's the same principle: exactly one place owns this fact
  // (Orrery's View.hiddenElementIds), everything else just reads it live,
  // so the two surfaces can never quietly drift out of sync the way a
  // second, independently-toggled combatant.hidden flag already had.
  // Fetch-once-then-stale, same shape as the active encounter cache below —
  // a live-stream subscription to the "map" kind (startLiveStream) wakes
  // this up sooner on an actual change, same "poll is correct, live-stream
  // is just faster" relationship every other cache in this file already has.
  const ACTIVE_MAP_STALE_MS = 8000;
  let activeMapCache = null;
  let activeMapFetchedAt = 0;
  let pendingActiveMapFetch = false;
  function getCachedActiveMap() {
    return activeMapCache;
  }
  function ensureActiveMapCached(onLoaded) {
    if (!groupId || !dataManager || pendingActiveMapFetch) return;
    if (activeMapCache && Date.now() - activeMapFetchedAt < ACTIVE_MAP_STALE_MS) return;
    pendingActiveMapFetch = true;
    (async () => {
      try {
        // Spotlighted (actually shown to players) takes priority when one
        // exists — that's the definitive, group-wide "the" active map,
        // exactly what player mode is ALSO restricted to (a player can
        // never legitimately see anything un-spotlighted, so this is the
        // only source that even makes sense for them). resolveActiveMapId
        // is the fallback, GM-only, for the "prepping before showing
        // anything to the table yet" case that has no spotlight at all —
        // see this widget's own init option comment.
        const mapId = (await resolveActiveSpotlightId(dataManager, { groupId, kind: "map" })) || resolveActiveMapId?.() || "";
        if (!mapId) {
          // A TRUTHY empty placeholder, not null — confirmed real bug this
          // fixes: null failed the staleness guard's own `activeMapCache &&`
          // check above (a falsy cache always looked "not yet fetched"), so
          // with no active map spotlighted at all — a completely normal,
          // common state — every single render re-triggered a fresh fetch,
          // whose completion called onLoaded (render()) again, which
          // triggered another fetch... a tight async loop that read as
          // constant flashing and blocked all interaction. Same fix already
          // applied once for this exact class of bug — see this file's own
          // activeEncounterCache (app.js) precedent, which sets a resolved
          // placeholder object rather than null for the identical reason.
          activeMapCache = { id: "", payload: {} };
          return;
        }
        const result = await dataManager.get("map", mapId, { preferLocal: false });
        activeMapCache = { id: mapId, payload: result?.payload || {} };
      } catch (error) {
        activeMapCache = { id: "", payload: {} };
      } finally {
        activeMapFetchedAt = Date.now();
        pendingActiveMapFetch = false;
        onLoaded?.();
      }
    })();
  }

  // Every marker on the active map that represents `combatant` — refKind+
  // refId matched, disambiguated by marker.linkedCombatantId when more than
  // one marker/combatant pairing shares that refId (same convention map-
  // viewer.js's own resolveMarkerLinkedCombatant uses, just inverted: that
  // one starts from a marker and finds its combatant, this starts from a
  // combatant and finds its marker(s)). Returns [] — not an error — when
  // there's no active map, no map data yet, or genuinely no marker for this
  // combatant at all (it just hasn't been placed); callers treat an empty
  // result as "nothing to show/toggle," not a failure.
  function resolveCombatantMarkers(combatant, map) {
    if (!map?.payload || !combatant?.refId) return [];
    const matches = [];
    (map.payload.layers || []).forEach((layer) => {
      if (layer.type !== "marker") return;
      (layer.elements || []).forEach((marker) => {
        if (marker.kind === "marker" && marker.refKind === combatant.refKind && marker.refId === combatant.refId) {
          matches.push({ layer, marker });
        }
      });
    });
    if (matches.length <= 1) return matches;
    const linked = matches.filter(({ marker }) => marker.linkedCombatantId === combatant.id);
    // Genuinely ambiguous (multiple candidates, none explicitly linked to
    // THIS combatant) — [] rather than guessing which one(s) to affect;
    // callers already treat that the same as "nothing to show/toggle."
    return linked;
  }

  // Read-only — whether ANY marker representing `combatant` on the active
  // map is currently in that map's auto-managed "Player View" (see Orrery's
  // own isElementHiddenFromPlayers, the identical read against state.map
  // instead of a fetched copy). False (not an error, not "unknown") when
  // there's no linked marker at all right now — nothing placed yet reads as
  // "visible," matching the default a marker itself starts with.
  function isCombatantHiddenFromPlayers(combatant) {
    const map = getCachedActiveMap();
    const markers = resolveCombatantMarkers(combatant, map);
    if (!markers.length) return false;
    const view = (map.payload.views || []).find((entry) => entry.autoManaged);
    const hiddenIds = new Set(view?.hiddenElementIds || []);
    return markers.some(({ marker }) => hiddenIds.has(marker.id));
  }

  // Write-through — toggles every marker resolveCombatantMarkers finds for
  // this combatant in/out of the active map's own auto-managed View, same
  // read-modify-write-against-the-FRESH-server-copy shape
  // writeThroughToCharacter and Orrery's own autoSaveHiddenFromPlayersView
  // already use (never state's own possibly-stale cached copy — another GM
  // tab, or Orrery itself, could have changed this map in the moments
  // since). A no-op (status message, not a silent failure) when there's no
  // active map or no linked marker to toggle at all — see the toolbar
  // button's own disabled state for why that's expected, not an error case.
  async function toggleCombatantHiddenFromPlayers(combatant) {
    const map = getCachedActiveMap();
    // !map.id, not !map — getCachedActiveMap() always returns a truthy
    // object now, even for "no active map" (see ensureActiveMapCached's own
    // comment for why that has to be true rather than null).
    if (!map?.id) {
      status?.show("No map is shown to the table or open on your dashboard to show/hide this combatant on.", {
        type: "warning",
        timeout: 2500,
      });
      return;
    }
    const markerIds = resolveCombatantMarkers(combatant, map).map(({ marker }) => marker.id);
    if (!markerIds.length) {
      status?.show("This combatant isn't placed on the active map yet.", { type: "warning", timeout: 2500 });
      return;
    }
    const nextHidden = !isCombatantHiddenFromPlayers(combatant);
    try {
      const result = await dataManager.get("map", map.id, { preferLocal: false });
      const freshMap = result.payload;
      freshMap.views = Array.isArray(freshMap.views) ? freshMap.views : [];
      let view = freshMap.views.find((entry) => entry.autoManaged);
      if (!view) {
        view = createView({ name: "Player View (auto)", tiers: ["player"], autoManaged: true });
        freshMap.views.push(view);
      }
      const hidden = new Set(view.hiddenElementIds || []);
      markerIds.forEach((id) => {
        if (nextHidden) hidden.add(id);
        else hidden.delete(id);
      });
      view.hiddenElementIds = Array.from(hidden);
      await dataManager.save("map", map.id, freshMap);
      activeMapCache = { id: map.id, payload: freshMap };
      activeMapFetchedAt = Date.now();
      render();
    } catch (error) {
      status?.show(error?.message || "Unable to save that change.", { type: "error" });
    }
  }

  // Set the instant a local edit happens (markDirty, below) and only
  // cleared once persist()'s own debounced save actually finishes — see
  // refreshCurrentEncounter's own comment for the race this closes. This is
  // the same "don't apply a fetch that could be older than a write we
  // already know about" problem map-live-sync.js's watchMapForChanges
  // already solved for maps (localWriteSeq/noteLocalWrite) — combat-
  // tracker.js's own encounter refresh never got that same protection.
  let pendingEncounterWrite = false;

  const persist = debounce(async () => {
    if (!state.encounter || mode !== "gm") {
      // markDirty always sets pendingEncounterWrite before scheduling this
      // — clear it even on this early-out (mode is only ever "gm" in
      // practice by the time markDirty is reachable, but nothing here
      // should ever leave the flag stuck true with no save in flight to
      // eventually clear it).
      pendingEncounterWrite = false;
      return;
    }
    try {
      // Library-sourced encounters never embed their own id in the body
      // (Loom's convention, matching every other Library kind) — strip it
      // from a clone before saving, not from state.encounter itself, since
      // every other function in this file keeps reading state.encounter.id.
      const { id: _id, ...body } = state.encounter;
      await dataManager.save("encounter", state.encounter.id, body);
    } catch (error) {
      status?.show(error.message || "Unable to save the encounter.", { type: "error" });
    } finally {
      pendingEncounterWrite = false;
    }
  }, 600);

  function markDirty() {
    // Flagged HERE, synchronously, not just once persist()'s debounced
    // timer actually fires — confirmed real bug this fixes: a monster/NPC
    // combatant's added condition only ever lives in state.encounter (no
    // separate write-through of its own, unlike a character combatant's —
    // see addTag's own comment), so it was purely at the mercy of this
    // 600ms debounce window. If the "encounter" live-stream event (which
    // fires on literally every save to ANY encounter in the group,
    // including this GM's own — the server has no way to know a change
    // came from the same tab that's about to persist it) landed inside
    // that window — a near-certainty, since the server-side live-stream
    // itself polls every ~1s — refreshCurrentEncounter would refetch the
    // still-stale (pre-edit) server copy and overwrite state.encounter
    // with it, silently discarding the just-typed condition before persist()
    // ever got a chance to save it. A Character combatant mostly self-healed
    // from the same race via its own independent writeThroughToCharacter
    // save plus the periodic per-character re-sync; a Monster/NPC combatant
    // had nothing to self-heal from, so it just... didn't stick.
    pendingEncounterWrite = true;
    render();
    persist();
  }

  function icon(name) {
    const span = el("span", "iconify");
    span.dataset.icon = name;
    span.setAttribute("aria-hidden", "true");
    return span;
  }

  function iconButton(iconName, label, className = "btn-outline-secondary") {
    const button = el("button", `btn btn-sm ${className}`);
    button.type = "button";
    button.title = label;
    button.setAttribute("aria-label", label);
    button.setAttribute("data-bs-toggle", "tooltip");
    button.appendChild(icon(iconName));
    return button;
  }

  // --- GM: loading/creating encounters ---------------------------------

  async function loadSystemsList() {
    try {
      const listing = await dataManager.list("system", { refresh: true });
      state.systemsList = dataManager.collectListEntries(listing.remote, ["owned", "shared", "public", "items"]);
    } catch (error) {
      state.systemsList = [];
    }
  }

  async function loadCombatantEntityLists() {
    const kinds = ["character", "npc", "monster"];
    const results = await Promise.all(
      kinds.map(async (kind) => {
        try {
          const listing = await dataManager.list(kind, { refresh: true });
          return dataManager
            .collectListEntries(listing.remote, ["owned", "shared", "public", "items"])
            .slice()
            .sort((a, b) => (a.title || a.name || a.id).localeCompare(b.title || b.name || b.id));
        } catch (error) {
          return [];
        }
      })
    );
    state.combatantEntityLists = Object.fromEntries(kinds.map((kind, index) => [kind, results[index]]));
  }

  async function loadOwnedEncounters() {
    const listing = await dataManager.list("encounter", { refresh: true });
    const remote = dataManager.collectListEntries(listing.remote, ["owned"]);
    const local = dataManager.listLocalEntries("encounter") || [];
    // Dedupe by id (prefer the remote entry, which carries a real title) —
    // an encounter created while offline/anonymous and later synced could
    // otherwise appear twice: once via its local copy (labeled by raw id)
    // and once via the server copy (labeled by name).
    const byId = new Map();
    [...local, ...remote].forEach((entry) => {
      if (entry?.id) byId.set(entry.id, entry);
    });
    state.ownedEncounters = Array.from(byId.values());
  }

  async function selectEncounter(id) {
    state.selectedCombatantId = "";
    state.announced = false;
    if (!id) {
      state.encounter = null;
      render();
      return;
    }
    try {
      // preferLocal: false — every other network read of an encounter in
      // this file already does this (pollActiveEncounter,
      // refreshCurrentEncounter, the macro runner's loadMacroEncounter); this
      // one was the sole exception. Confirmed real bug: a GM's own tracker
      // — including on a fresh page reload, since init() below calls this
      // same function to resume whichever encounter is active — kept
      // showing its last-known LOCAL copy indefinitely (initiative stuck at
      // whatever it was before) whenever a player pushed initiative from
      // their own character sheet, since that write only ever lands on the
      // server + the player's own local cache, never the GM's.
      const result = await dataManager.get("encounter", id, { shareToken, preferLocal: false });
      state.encounter = result.payload;
      // The record's own id isn't in the body (see persist's own comment) —
      // stamp it from the id this was fetched by, same as every other
      // Library-kind loader in the suite.
      state.encounter.id = id;
      const fields = await loadSystemFields(dataManager, state.encounter.systemId);
      state.combatBindings = deriveCombatBindings(fields);
      state.conditions = deriveConditionsVocabulary(fields, state.combatBindings);
      render();
    } catch (error) {
      status?.show("Unable to load that encounter.", { type: "error" });
      // Same self-heal as pollActiveEncounter's own — a GM hitting a dead
      // ?encounter=<id> deep link is just as good a moment to notice the
      // group's active spotlight is stale and clear it for every viewer,
      // not only a player's own passive poll finding it later.
      if (error?.status === 404 && groupId) {
        const activeId = await resolveActiveSpotlightId(dataManager, { groupId, shareToken, kind: "encounter" }).catch(
          () => ""
        );
        if (activeId === id) {
          await dataManager.clearSpotlight({ groupId, shareToken, kind: "encounter", id }).catch(() => {});
        }
      }
    }
  }

  async function createEncounter() {
    const name = window.prompt("Name this encounter:", "New Encounter");
    if (name === null) return;
    const encounter = blankEncounter(name.trim() || "New Encounter");
    try {
      const { id: _id, ...body } = encounter;
      await dataManager.save("encounter", encounter.id, body);
      state.encounter = encounter;
      state.conditions = null;
      state.combatBindings = null;
      state.selectedCombatantId = "";
      state.announced = false;
      await loadOwnedEncounters();
      render();
    } catch (error) {
      status?.show(error.message || "Unable to create the encounter.", { type: "error" });
    }
  }

  async function deleteEncounter() {
    if (!state.encounter) return;
    if (!confirmDelete({ label: `"${state.encounter.name}"` })) return;
    const deletedId = state.encounter.id;
    try {
      await dataManager.delete("encounter", deletedId);
      state.encounter = null;
      await loadOwnedEncounters();
      render();
      // Deleting the campaign's currently-spotlighted encounter would
      // otherwise leave every viewer (any player polling, or the GM's own
      // tab on a future reload via ?encounter=<id>) stuck re-fetching a dead
      // id forever — checked authoritatively against the group's actual
      // active spotlight (resolveActiveSpotlightId), not the local-only
      // state.announced flag, since that resets on reload even when the
      // spotlight itself is still live. See pollActiveEncounter's own
      // matching cleanup for the reactive half of this (an already-stale
      // spotlight from before this fix existed).
      if (groupId) {
        const activeId = await resolveActiveSpotlightId(dataManager, { groupId, shareToken, kind: "encounter" }).catch(
          () => ""
        );
        if (activeId === deletedId) {
          await dataManager.clearSpotlight({ groupId, shareToken, kind: "encounter", id: deletedId }).catch(() => {});
        }
      }
    } catch (error) {
      status?.show(error.message || "Unable to delete the encounter.", { type: "error" });
    }
  }

  async function changeSystem(systemId) {
    if (!state.encounter) return;
    state.encounter.systemId = systemId;
    const fields = await loadSystemFields(dataManager, systemId);
    state.combatBindings = deriveCombatBindings(fields);
    state.conditions = deriveConditionsVocabulary(fields, state.combatBindings);
    markDirty();
  }

  // --- GM: combatants ----------------------------------------------------

  function selectedCombatant() {
    return state.encounter?.combatants.find((c) => c.id === state.selectedCombatantId) || null;
  }

  // Clicking a row selects it and shows its details below the list;
  // clicking the SAME row again deselects it (toggle) — the only way to
  // deselect now that there's no "click away" (removed: it fired for
  // clicks anywhere else on the page, including the adjacent help pane,
  // and read as the selection randomly vanishing).
  function selectCombatant(id) {
    state.selectedCombatantId = state.selectedCombatantId === id ? "" : id;
    render();
  }

  // Monster, Forge NPC, and now character records all resolve through the
  // same combatBindings resource/value paths writeThroughToCharacter uses to
  // write back — a freshly added combatant starts at whatever the source
  // record's own current/max already are (a fresh monster/NPC's current
  // always equals max; a character's current reflects any damage it's
  // already carrying). Falls back to the resource's max if current is
  // somehow absent. A System with no matching binding, or a record with
  // nothing at that path (a not-yet-imported character, a Freeform
  // combatant), falls back to the existing manual-entry 0/0 default —
  // previously this hardcoded `stats.hitPoints`/`stats.armorClass` directly
  // instead of resolving through the configured bindings, silently
  // disagreeing with writeThroughToCharacter for any System whose paths
  // pointed elsewhere.
  async function addCombatant({ refKind, refId, name }) {
    if (!state.encounter) return;
    let resolvedName = name;
    let stats = { hp: 0, maxHp: 0, tempHp: 0, ac: 0 };
    if (refKind && refId) {
      try {
        const result = await dataManager.get(refKind, refId, { preferLocal: false });
        const payload = result.payload || {};
        if (!resolvedName) resolvedName = payload.name || payload.title || refId;
        stats = resolveCombatantStats(state.combatBindings, payload);
      } catch (error) {
        resolvedName = resolvedName || refId;
      }
    }
    state.encounter.combatants.push({
      id: randomId(),
      name: uniquifyCombatantName(resolvedName || "Combatant", state.encounter.combatants),
      refKind: refKind || null,
      refId: refId || null,
      initiative: 0,
      hp: stats.hp,
      maxHp: stats.maxHp,
      tempHp: stats.tempHp,
      ac: stats.ac,
      conditions: [],
      hiddenTags: [],
      isPc: refKind === "character",
    });
    markDirty();
  }

  function removeCombatant(id) {
    if (!state.encounter) return;
    const index = state.encounter.combatants.findIndex((c) => c.id === id);
    if (index === -1) return;
    state.encounter.combatants.splice(index, 1);
    if (state.encounter.activeIndex > index) {
      state.encounter.activeIndex -= 1;
    }
    if (state.selectedCombatantId === id) {
      state.selectedCombatantId = "";
    }
    markDirty();
  }

  function toggleSelectedHidden() {
    const combatant = selectedCombatant();
    if (!combatant) return;
    void toggleCombatantHiddenFromPlayers(combatant);
  }

  function deleteSelected() {
    if (!state.selectedCombatantId) return;
    removeCombatant(state.selectedCombatantId);
  }

  function sortByInitiative() {
    if (!state.encounter) return;
    state.encounter.combatants.sort((a, b) => (b.initiative || 0) - (a.initiative || 0));
    state.encounter.activeIndex = 0;
    markDirty();
  }

  // Players roll their own characters' initiative on their sheet (the
  // template's own Initiative field/roller — see tpl.5e.flex-basic.json),
  // so this only touches non-character combatants: monster/npc combatants
  // (whose linked record supplies a modifier via combatBindings' own
  // "modifier"-role entry, the same generic binding-path mechanism as
  // HP/AC/Conditions) and freeform combatants (no linked record, so a flat
  // roll with +0). The die itself comes from that entry's own `die` (e.g.
  // "d20"), defaulting to d20 for Systems that don't specify one. Best-effort
  // per combatant — a record fetch failure just falls back to +0 rather than
  // aborting the whole roll.
  async function rollInitiativeForNonCharacters() {
    if (!state.encounter) return;
    const targets = state.encounter.combatants.filter((c) => c.refKind !== "character");
    if (!targets.length) return;
    const modifierEntry = findBindingByRole(state.combatBindings, "modifier");
    const modifierPath = modifierEntry?.binding;
    const sides = Number(String(modifierEntry?.die || "d20").replace(/^d/i, "")) || 20;
    await Promise.all(
      targets.map(async (combatant) => {
        let modifier = 0;
        if (modifierPath && combatant.refKind && combatant.refId) {
          try {
            const result = await dataManager.get(combatant.refKind, combatant.refId, { preferLocal: false });
            const resolved = Number(resolveBinding(modifierPath, result.payload || {}));
            if (Number.isFinite(resolved)) modifier = resolved;
          } catch (error) {
            // Fall back to +0 — see comment above.
          }
        }
        combatant.initiative = rollDiceExpression(`1d${sides}`).total + modifier;
      })
    );
    markDirty();
  }

  function advanceTurn(delta) {
    if (!state.encounter || !state.encounter.combatants.length) return;
    const count = state.encounter.combatants.length;
    let next = state.encounter.activeIndex + delta;
    if (next >= count) {
      next = 0;
      state.encounter.round += 1;
    } else if (next < 0) {
      next = count - 1;
      state.encounter.round = Math.max(1, state.encounter.round - 1);
    }
    state.encounter.activeIndex = next;
    markDirty();
  }

  // A character-combatant's HP/conditions treat the character record as the
  // source of truth (the opposite of monster/npc, whose base record never
  // changes — see addCombatant's own comment): a GM edit here writes through
  // via the System's combatBindings paths, the same paths Workbench's own
  // character-sheet fields bind to, so both sides read/write one real
  // value instead of two independently-drifting copies. Best-effort — the
  // encounter's own copy (already updated by the caller before this runs)
  // stays this widget's authoritative value regardless of whether the
  // write-through succeeds, so failures are logged, not surfaced.
  async function writeThroughToCharacter(combatant, updates) {
    if (combatant.refKind !== "character" || !combatant.refId) return;
    const bindings = state.combatBindings;
    if (!bindings) return;
    const resource = findBindingByRole(bindings, "resource");
    const value = findBindingByRole(bindings, "value");
    const tags = findBindingByRole(bindings, "tags");
    try {
      // preferLocal: false — this is a read-modify-write round trip against
      // whatever the character record actually is right now (possibly just
      // changed by the player themselves, moments ago, on their own sheet);
      // a stale local cache here would silently clobber that change instead
      // of merging with it. Same reasoning as Loom's editor and Workbench's
      // own character loader (see their comments).
      const result = await dataManager.get("character", combatant.refId, { preferLocal: false });
      const character = result.payload || {};
      let changed = false;
      if (updates.hp !== undefined && resource?.binding) {
        setAtBinding(resource.binding, character, updates.hp);
        changed = true;
      }
      if (updates.maxHp !== undefined && resource?.maxPath) {
        setAtBinding(resource.maxPath, character, updates.maxHp);
        changed = true;
      }
      if (updates.tempHp !== undefined && resource?.tempPath) {
        setAtBinding(resource.tempPath, character, updates.tempHp);
        changed = true;
      }
      if (updates.ac !== undefined && value?.binding) {
        setAtBinding(value.binding, character, updates.ac);
        changed = true;
      }
      if (updates.conditions !== undefined && tags?.binding) {
        setAtBinding(tags.binding, character, updates.conditions);
        changed = true;
      }
      // Not a game-mechanical field a System defines a binding for (unlike
      // conditions above) — a suite-level annotation of which of THIS
      // character's own conditions/tags are hidden from map marker badges
      // (see resolveMarkerConditionIcons), so it always lives at this same
      // fixed key regardless of System, the same way overlayIcons/heightCells
      // live at fixed keys on a marker rather than through a binding.
      if (updates.hiddenTags !== undefined) {
        character.hiddenTags = updates.hiddenTags;
        changed = true;
      }
      if (changed) {
        await dataManager.save("character", combatant.refId, character);
      }
    } catch (error) {
      console.warn("Combat tracker: unable to write through to character", combatant.refId, error);
    }
  }

  function addTag(combatant, rawValue, hidden = false) {
    const value = String(rawValue || "").trim();
    if (!value || combatant.conditions.includes(value)) return;
    combatant.conditions.push(value);
    if (hidden) {
      combatant.hiddenTags = combatant.hiddenTags || [];
      combatant.hiddenTags.push(value);
    }
    markDirty();
    void writeThroughToCharacter(combatant, { conditions: combatant.conditions, hiddenTags: combatant.hiddenTags || [] });
  }

  function removeTag(combatant, value) {
    const index = combatant.conditions.indexOf(value);
    if (index === -1) return;
    combatant.conditions.splice(index, 1);
    // Cleanup — a removed tag shouldn't linger in hiddenTags forever, e.g.
    // silently suppressing a LATER, unrelated tag that happens to reuse the
    // same text.
    if (Array.isArray(combatant.hiddenTags)) {
      const hiddenIndex = combatant.hiddenTags.indexOf(value);
      if (hiddenIndex !== -1) combatant.hiddenTags.splice(hiddenIndex, 1);
    }
    markDirty();
    void writeThroughToCharacter(combatant, { conditions: combatant.conditions, hiddenTags: combatant.hiddenTags || [] });
  }

  // Visibility ("Show to table") and combat state ("Start/Stop") are fully
  // independent controls, with zero automatic coupling in either direction
  // — starting combat no longer implicitly shows it, stopping doesn't hide
  // it, and hiding doesn't stop combat. Each is only ever changed by its
  // own explicit button.
  async function showToTable() {
    if (!state.encounter || state.announced) return;
    const active = dataManager.getActiveGroup();
    if (!active?.groupId) {
      status?.show("Pick an active campaign first (see the Campaign menu in the header).", {
        type: "warning",
        timeout: 3000,
      });
      return;
    }
    try {
      await dataManager.spotlightToGroup({
        groupId: active.groupId,
        contentType: "encounter",
        contentId: state.encounter.id,
        data: { hidden: false },
      });
      state.announced = true;
      status?.show("Showing to the table.", { type: "success", timeout: 2000 });
      render();
    } catch (error) {
      status?.show(error.message || "Unable to show the encounter to the table.", { type: "error" });
    }
  }

  // Marks the spotlight `data.hidden` instead of clearing it outright (the
  // old behavior — dataManager.clearSpotlight) — confirmed real bug that
  // fixes: a fully-cleared encounter stopped being "the active encounter"
  // for ANY purpose at all, including character-sheet.js's own
  // pushInitiativeToActiveEncounter — a GM hiding combat from the table
  // (a deliberate, supported thing to want — running a private encounter
  // players still roll initiative into) broke initiative pushing entirely,
  // not just table visibility. updateSpotlightData posts a
  // `spotlight-update` entry, which resolveActiveSpotlights/
  // resolveActiveSpotlightId already treat as equally "active" as the
  // original `spotlight` entry (see spotlight.js's own comment) — the
  // encounter stays findable, just flagged not-for-display. Player-facing
  // rendering (this file's own resolveActiveEncounterId, the spotlight
  // panel/Game Log in dashboard.js) is what actually checks the flag and
  // hides accordingly.
  async function hideFromTable() {
    if (!state.encounter || !state.announced) return;
    const active = dataManager.getActiveGroup();
    if (!active?.groupId) return;
    try {
      await dataManager.updateSpotlightData({
        groupId: active.groupId,
        kind: "encounter",
        id: state.encounter.id,
        data: { hidden: true },
      });
      // Only flip state (and re-render the now-off toggle) on confirmed
      // success — same shape as showToTable's own try block. Setting this
      // unconditionally after the try/catch used to desync client from
      // server on any failure: the toggle would visually turn off
      // immediately, then flip back on after a refresh once the page
      // re-fetched the real (still-active) server state, with no obvious
      // explanation why — confirmed real bug, not just theoretical.
      state.announced = false;
      status?.show("Stopped showing to the table.", { type: "success", timeout: 2000 });
      render();
    } catch (error) {
      status?.show(error.message || "Unable to stop showing.", { type: "error" });
    }
  }

  async function toggleVisibility() {
    if (state.announced) {
      await hideFromTable();
    } else {
      await showToTable();
    }
  }

  // Start places the turn indicator on the first combatant at round 1;
  // Stop clears both (no turn indicator, no Round display). Deliberately
  // touches nothing about visibility, in either direction — Start used to
  // also auto-spotlight the encounter (a "visible by default" convenience),
  // but per the user's own explicit call, active/started and visible/shown
  // must be two fully independent toggles with zero automatic coupling
  // either way — hitting both buttons is one extra click, in exchange for
  // being able to run combat privately from turn 1 (not just after
  // starting-then-hiding) or leave a hidden encounter shown from an earlier
  // session while re-starting it. See showToTable/hideFromTable's own
  // comment for the other half of this split.
  function startCombat() {
    if (!state.encounter) return;
    state.encounter.started = true;
    state.encounter.round = 1;
    state.encounter.activeIndex = 0;
    markDirty();
  }

  function stopCombat() {
    if (!state.encounter) return;
    state.encounter.started = false;
    markDirty();
  }

  // --- Player: read-only polling -----------------------------------------

  async function resolveActiveEncounterId() {
    if (encounterId) return encounterId;
    const id = await resolveActiveSpotlightId(dataManager, { groupId, shareToken, kind: "encounter" });
    if (!id) return "";
    // A hidden encounter (see hideFromTable's own comment) is still the
    // campaign's ACTIVE encounter — character-sheet.js's own initiative
    // push needs to keep finding it regardless of visibility — but a
    // player-mode tracker's own rendering must still respect "not shown to
    // the table." Checking the resolved data here (not just
    // resolveActiveSpotlightId's own id-only answer) is what makes that
    // distinction: an id existing doesn't mean this viewer should see it.
    const data = await resolveSpotlightData(dataManager, { groupId, shareToken, kind: "encounter", id });
    if (data?.hidden === true) return "";
    return id;
  }

  async function pollActiveEncounter() {
    if (state.destroyed) return;
    const id = await resolveActiveEncounterId();
    if (!id) {
      state.encounter = null;
      render();
      return;
    }
    try {
      const result = await dataManager.get("encounter", id, { shareToken, preferLocal: false });
      state.encounter = result.payload;
      state.encounter.id = id;
      if (!state.conditions || state.conditions.__systemId !== state.encounter.systemId) {
        const fields = await loadSystemFields(dataManager, state.encounter.systemId);
        state.combatBindings = deriveCombatBindings(fields);
        state.conditions = deriveConditionsVocabulary(fields, state.combatBindings);
        if (state.conditions) state.conditions.__systemId = state.encounter.systemId;
      }
      render();
    } catch (error) {
      state.encounter = null;
      render();
      // A confirmed 404 (not "not shared with this viewer yet," a 403/other
      // error, or a network blip) means the spotlighted encounter itself is
      // gone — deleteEncounter is supposed to clear the spotlight when it
      // deletes the active one, but this covers any record that ends up
      // gone without that (an older deletion, a manual file removal, ...).
      // Clearing it here, group-wide, is what actually stops every viewer's
      // poll from re-hitting this same dead id every 15s forever — every
      // group member (not just the GM) is allowed to post a spotlight-clear
      // log entry (see groups.py's create_group_log_entry), so this is safe
      // to do from a player's own passive polling, not just the GM's tab.
      if (error?.status === 404 && groupId) {
        dataManager.clearSpotlight({ groupId, shareToken, kind: "encounter", id }).catch(() => {});
      }
    }
  }

  // createReliableInterval (not plain window.setInterval) — a player-mode
  // tracker popped out onto a physical second screen sits unfocused for the
  // whole session; the browser's own background-tab timer throttling was
  // confirmed to stall this poll until the window was manually refocused.
  // See reliable-interval.js's own header for how/why this stays reliable.
  function startPolling() {
    stopPolling();
    state.pollTimer = createReliableInterval(() => {
      void pollActiveEncounter();
    }, POLL_INTERVAL_MS);
  }

  function stopPolling() {
    if (state.pollTimer) {
      state.pollTimer.stop();
      state.pollTimer = 0;
    }
  }

  // Wakes the existing poll functions up sooner on a relevant change — never
  // a replacement for them (see live.js's own comment): if the stream can't
  // connect, or drops, polling alone keeps working exactly as it already
  // does. GM mode has no poll loop of its own today (a GM is assumed to be
  // the one making changes) except for this: a character-combatant's HP/
  // conditions can now change from *outside* the tracker entirely (a player
  // editing their own sheet — see Phase 5's write-through), so GM mode
  // subscribes too, purely to catch that.
  let liveStream = null;

  // Unlike selectEncounter() (a deliberate user action — resets selection,
  // re-announces), this is triggered by *someone else's* change (another GM
  // tab) landing on the encounter this one already has open, so it swaps in
  // the fresh data without disturbing what this GM currently has selected.
  async function refreshCurrentEncounter() {
    if (!state.encounter) return;
    // Skip entirely while a local edit is still queued/mid-save — see
    // pendingEncounterWrite's own comment for the confirmed bug this
    // prevents: this fires on literally every encounter save in the group,
    // including this GM's own not-yet-persisted one, and would otherwise
    // overwrite state.encounter with a stale pre-edit copy.
    if (pendingEncounterWrite) return;
    const id = state.encounter.id;
    try {
      const result = await dataManager.get("encounter", id, { preferLocal: false });
      // Re-checked after the await, not just before it — a local edit can
      // start WHILE this fetch is in flight, in which case its result is
      // now the stale one, same reasoning as the check above.
      if (pendingEncounterWrite) return;
      state.encounter = result.payload;
      state.encounter.id = id;
      render();
    } catch (error) {
      // Deleted elsewhere, or a transient fetch failure — leave the current
      // view as-is rather than clearing it out from under the GM.
    }
  }

  async function refreshCombatantFromCharacter(characterId) {
    if (!state.encounter) return;
    const combatant = state.encounter.combatants.find(
      (entry) => entry.refKind === "character" && entry.refId === characterId
    );
    if (!combatant) return;
    try {
      const result = await dataManager.get("character", characterId, { preferLocal: false });
      const payload = result.payload || {};
      const resource = findBindingByRole(state.combatBindings, "resource");
      const value = findBindingByRole(state.combatBindings, "value");
      const tags = findBindingByRole(state.combatBindings, "tags");
      if (resource?.binding) {
        // Each of current/max/temp updates independently based on whether
        // ITS OWN path resolves to a number — confirmed real bug this fixes:
        // current HP used to only ever update when max ALSO resolved as a
        // number (nested inside that same check), so a System with no
        // maxPath configured for its resource binding at all — or one where
        // max just failed to resolve for any reason — silently never
        // reflected a player's own current-HP edit here either, even though
        // current resolved fine on its own. Same "leave alone if
        // unresolvable" fallback the AC/Conditions checks just below already
        // use, not resolveCombatantStats' own zero-default (that function is
        // for seeding a BRAND NEW combatant, where 0 is a reasonable
        // "nothing configured" default — here, an existing combatant's
        // already-known value should never get silently reset to 0 just
        // because the character record briefly didn't resolve one field).
        const current = resolveBinding(resource.binding, payload);
        if (typeof current === "number") combatant.hp = current;
        if (resource.maxPath) {
          const max = resolveBinding(resource.maxPath, payload);
          if (typeof max === "number") combatant.maxHp = max;
        } else if (typeof resource.max === "number") {
          // A literal ceiling (e.g. Daggerheart's Hope: max 6) isn't stored
          // anywhere on the character record to resolve — it's just always
          // this fixed value, the same way maxPath's resolved value would be
          // if it were bound.
          combatant.maxHp = resource.max;
        }
        if (resource.tempPath) {
          const temp = resolveBinding(resource.tempPath, payload);
          if (typeof temp === "number") combatant.tempHp = temp;
        }
      }
      if (value?.binding) {
        const resolvedValue = resolveBinding(value.binding, payload);
        if (typeof resolvedValue === "number") combatant.ac = resolvedValue;
      }
      if (tags?.binding) {
        const resolvedTags = resolveBinding(tags.binding, payload);
        if (Array.isArray(resolvedTags)) combatant.conditions = resolvedTags.slice();
      }
      markDirty();
    } catch (error) {
      // Character deleted/inaccessible — leave the combatant's existing
      // mirror alone rather than erroring the whole tracker.
    }
  }

  // Safety-net sweep, not the primary update path — the live-stream
  // subscription above is what makes an edit feel instant. A live-stream
  // connection can silently miss an event (a backgrounded/throttled tab —
  // browsers routinely deprioritize timers and can delay reconnects in an
  // unfocused tab; the reconnect backoff itself climbs up to 15s after
  // repeated failures; a connection torn down and recreated at the wrong
  // moment) with nothing else ever noticing or retrying that specific
  // missed change. Confirmed real gap: GM mode had NO fallback poll at all
  // for character-driven combatant stats before this — every other poller
  // in this file/suite (player mode's own pollActiveEncounter, Game Log,
  // spotlight-inbox) already follows "live-stream wakes it up sooner, a
  // plain poll guarantees it eventually happens regardless" — GM mode's
  // character sync was the one exception, purely live-stream-or-never. This
  // re-syncs every PC combatant from its live character record on a fixed
  // cadence, independent of whether any live-stream event for it was ever
  // received, giving character->encounter sync a bounded worst-case
  // latency instead of an unbounded "maybe never."
  async function syncAllCharacterCombatants() {
    if (!state.encounter) return;
    const characterIds = new Set(
      state.encounter.combatants
        .filter((combatant) => combatant.refKind === "character" && combatant.refId)
        .map((combatant) => combatant.refId)
    );
    await Promise.all(Array.from(characterIds).map((id) => refreshCombatantFromCharacter(id)));
  }

  function startGmCharacterSync() {
    stopGmCharacterSync();
    void syncAllCharacterCombatants();
    state.gmSyncTimer = createReliableInterval(() => {
      void syncAllCharacterCombatants();
    }, POLL_INTERVAL_MS);
  }

  function stopGmCharacterSync() {
    if (state.gmSyncTimer) {
      state.gmSyncTimer.stop();
      state.gmSyncTimer = 0;
    }
  }

  // Forces the next ensureActiveMapCached call to actually refetch instead
  // of trusting the stale-but-not-yet-expired cached copy — same "collapse
  // the relevant cache entry and re-render immediately" reasoning
  // Orrery's own app.js and the Dashboard's map.js widget already apply to
  // THEIR OWN "encounter"/"character" live-stream subscriptions, just for
  // Combat Tracker's own "map" one (isCombatantHiddenFromPlayers reads live
  // from that data now — see its own header comment).
  function invalidateActiveMapCache() {
    activeMapCache = null;
    activeMapFetchedAt = 0;
  }

  function startLiveStream() {
    liveStream?.close();
    if (!groupId) return;
    if (mode === "gm") {
      liveStream = connectLiveStream({ dataManager, groupId, kinds: ["encounter", "character", "map"], shareToken });
      liveStream.subscribe("encounter", (payload) => {
        if (state.encounter && payload.id === state.encounter.id) {
          void refreshCurrentEncounter();
        }
      });
      liveStream.subscribe("character", (payload) => {
        void refreshCombatantFromCharacter(payload.id);
      });
      liveStream.subscribe("map", () => {
        invalidateActiveMapCache();
        render();
      });
    } else {
      liveStream = connectLiveStream({ dataManager, groupId, kinds: ["encounter", "map"], shareToken });
      liveStream.subscribe("encounter", () => {
        void pollActiveEncounter();
      });
      liveStream.subscribe("map", () => {
        invalidateActiveMapCache();
        render();
      });
    }
  }

  // --- Rendering: shared bits ----------------------------------------------

  function renderAcBadge(combatant) {
    const wrap = el("span", "d-flex align-items-center gap-1 text-body-secondary small");
    wrap.appendChild(icon("tabler:shield"));
    wrap.appendChild(el("span", null, String(combatant.ac ?? 0)));
    return wrap;
  }

  // tag-editor.js's shared renderTagBadges — takes this combatant's own
  // conditions list + this System's vocabulary (state.conditions) plus an
  // onRemove that knows how to write a change back to THIS combatant, since
  // the shared function has no idea what a "combatant" is.
  function renderCombatantTagBadges(combatant, { removable }) {
    return renderTagBadges(combatant.conditions, state.conditions, {
      removable,
      // Re-resolves the CURRENT live combatant by id rather than closing
      // over `combatant` directly — see syncEditPanelValues' own tagInput
      // guard comment for why: that guard can keep this exact badge (and
      // its onRemove closure) mounted across a render where
      // refreshCurrentEncounter replaced state.encounter with an entirely
      // new object graph. `combatant` above would then be a detached,
      // orphaned object no longer part of state.encounter.combatants —
      // mutating it directly did nothing persist() could ever see (confirmed
      // real bug: a remove/add right after that swap silently vanished).
      onRemove: (value) => {
        const current = selectedCombatant();
        if (current) removeTag(current, value);
      },
      isHidden: (value) => (combatant.hiddenTags || []).includes(value),
    });
  }

  // --- Rendering: GM ---------------------------------------------------------

  // One cascading select instead of a kind-picker driving a second,
  // separately-loaded entity picker — the pair used to force this row wide
  // enough (kind + entity + name + button) to scroll sideways in a narrow
  // dashboard column the moment an entity list appeared. A text input with
  // a <datalist> lets the GM filter by typing instead of scrolling a long
  // `<select>` (which only gets longer as more characters/NPCs/monsters get
  // saved) while still resolving both kind and id from one field — each
  // datalist option's label is unique (name + kind suffix) and maps back to
  // {kind, id} via entryByLabel. Reads state.combatantEntityLists
  // synchronously (loaded once at init — see loadCombatantEntityLists)
  // rather than fetching on open, so this stays as fast/flicker-free as the
  // System picker already is.
  const COMBATANT_DATALIST_ID = "combat-tracker-combatant-suggestions";

  function buildCombatantEntries() {
    const lists = state.combatantEntityLists || {};
    const entries = [];
    ["character", "npc", "monster"].forEach((kind) => {
      (lists[kind] || []).forEach((entry) => {
        const name = entry.title || entry.name || entry.id;
        entries.push({ id: entry.id, kind, name, label: `${name} (${REF_KIND_LABELS[kind]})` });
      });
    });
    return entries;
  }

  // Built exactly ONCE (see ensureAddRowMounted below) and never rebuilt for
  // the rest of this widget instance's life — a previous fix here tried to
  // shadow the inputs' own live text/focus into `state` and restore them
  // after every rebuild, which reduced but never fully eliminated the bug
  // (confirmed by the user: focus was still intermittently lost). The only
  // fully reliable fix is to never destroy these <input> elements at all —
  // see ensureAddRowMounted's own comment for how that's structurally
  // guaranteed now, not just band-aided.
  function renderGmAddCombatantRow() {
    // flex-nowrap + overflow-x on the row (not the whole widget) — a single
    // inline row that scrolls sideways in a narrow column rather than ever
    // wrapping onto a second line. Kept as a safety net now, not a
    // necessity — with only two controls plus Add, this row fits a narrow
    // dashboard column without scrolling in practice.
    const row = el("div", "d-flex flex-nowrap gap-2 align-items-center overflow-x-auto pb-1");

    const entries = buildCombatantEntries();
    const entryByLabel = new Map(entries.map((entry) => [entry.label, entry]));

    const datalist = document.createElement("datalist");
    datalist.id = COMBATANT_DATALIST_ID;
    entries.forEach((entry) => datalist.appendChild(new Option(entry.label, entry.label)));
    row.appendChild(datalist);

    const combatantInput = el("input", "form-control form-control-sm flex-grow-1");
    combatantInput.type = "text";
    combatantInput.setAttribute("list", COMBATANT_DATALIST_ID);
    combatantInput.placeholder = "Character/NPC/monster…";
    combatantInput.style.minWidth = "10rem";

    const nameInput = el("input", "form-control form-control-sm flex-shrink-0");
    nameInput.placeholder = "Combatant name";
    nameInput.style.width = "9rem";

    combatantInput.addEventListener("change", () => {
      const match = entryByLabel.get(combatantInput.value);
      if (match) nameInput.value = match.name;
    });

    const addButton = el("button", "btn btn-primary btn-sm flex-shrink-0", "Add");
    addButton.type = "button";
    addButton.addEventListener("click", async () => {
      const match = entryByLabel.get(combatantInput.value.trim());
      await addCombatant({
        refKind: match ? match.kind : null,
        refId: match ? match.id : "",
        name: nameInput.value.trim() || (match ? match.name : ""),
      });
      nameInput.value = "";
      combatantInput.value = "";
    });

    row.append(combatantInput, nameInput, addButton);
    return row;
  }

  // Builds the single condensed top row: New Encounter (icon button) +
  // Encounter select + System select — folded from three separate rows into
  // one, matching how the rest of this widget's controls read. Called only
  // from refreshTopBar, itself only called when its own signature check
  // says something here actually changed (see topBarMount's declaration
  // comment) — reads systemsList/ownedEncounters synchronously, same
  // reasoning as the rest of this file's cached-list reads.
  function buildTopBarRow() {
    const row = el("div", "d-flex gap-2 align-items-end");

    const newButton = iconButton("tabler:plus", "New Encounter");
    newButton.addEventListener("click", createEncounter);
    row.appendChild(newButton);

    const pickerWrap = el("div", "flex-grow-1");
    pickerWrap.appendChild(el("label", "form-label small mb-1", "Encounter"));
    const picker = el("select", "form-select form-select-sm");
    picker.appendChild(new Option("Select an encounter…", ""));
    state.ownedEncounters.forEach((entry) => {
      picker.appendChild(new Option(entry.title || entry.name || entry.id, entry.id));
    });
    if (state.encounter) picker.value = state.encounter.id;
    picker.addEventListener("change", () => selectEncounter(picker.value));
    pickerWrap.appendChild(picker);
    row.appendChild(pickerWrap);

    if (state.encounter) {
      const systemWrap = el("div", "flex-grow-1");
      systemWrap.appendChild(el("label", "form-label small mb-1", "System"));
      const select = el("select", "form-select form-select-sm");
      select.appendChild(new Option("None", ""));
      (state.systemsList || []).forEach((entry) => select.appendChild(new Option(entry.title || entry.name || entry.id, entry.id)));
      select.value = state.encounter.systemId || "";
      select.addEventListener("change", () => changeSystem(select.value));
      systemWrap.appendChild(select);
      row.appendChild(systemWrap);
    }

    return row;
  }

  function renderEncounterToolbar() {
    const toolbar = el("div", "d-flex align-items-center gap-1");
    const startStopButton = iconButton(
      state.encounter.started ? "tabler:player-stop" : "tabler:player-play",
      state.encounter.started ? "Stop combat" : "Start combat",
      state.encounter.started ? "btn-primary" : "btn-outline-primary"
    );
    startStopButton.addEventListener("click", () => {
      if (state.encounter.started) {
        stopCombat();
      } else {
        startCombat();
      }
    });
    const prevButton = iconButton("tabler:chevron-left", "Previous turn");
    prevButton.addEventListener("click", () => advanceTurn(-1));
    const nextButton = iconButton("tabler:chevron-right", "Next turn");
    nextButton.addEventListener("click", () => advanceTurn(1));
    const sortButton = iconButton("tabler:arrows-sort", "Sort by initiative");
    sortButton.addEventListener("click", sortByInitiative);
    const rollInitiativeButton = iconButton("tabler:dice-5", "Roll initiative for NPCs/monsters");
    rollInitiativeButton.addEventListener("click", () => void rollInitiativeForNonCharacters());
    const deleteButton = iconButton("tabler:trash", "Delete encounter", "btn-outline-danger");
    deleteButton.addEventListener("click", deleteEncounter);
    toolbar.append(startStopButton, prevButton, nextButton, sortButton, rollInitiativeButton, deleteButton);
    return toolbar;
  }

  // Separate from Start/Stop — visibility to the table and whether combat
  // is actively running are independent (see startCombat/stopCombat's own
  // comment). Lives in the Dashboard card's own header now (setRightAction —
  // same right-side slot Map/Handout/Game Log use), not inline in the
  // widget's own content, so every widget that can be shown to the table
  // puts that toggle in the same place.
  function updateVisibilityAction() {
    if (!state.encounter) {
      setRightAction?.(null);
      return;
    }
    setRightAction?.({
      icon: state.announced ? "tabler:eye" : "tabler:eye-off",
      tooltip: state.announced ? "Visible to the table — click to hide" : "Not visible to the table — click to show",
      active: state.announced,
      onClick: () => void toggleVisibility(),
    });
  }

  // A badge (its own background box) reads clearly regardless of whether
  // the row is also selected — a left border, tried first, visually
  // disappeared once Bootstrap's `.active` selection background took over
  // the same edge of the row.
  // `.text-warning` carries `!important` in Bootstrap, so this stays
  // legible whether or not the row is also selected (a full badge read as
  // too big/heavy; a plain border disappeared under the selected-row
  // background).
  function renderTurnBadge() {
    const marker = el("span", "text-warning fw-bold", "▶");
    marker.title = "Current turn";
    marker.setAttribute("aria-label", "Current turn");
    return marker;
  }

  // Temp HP is a separate buffer on top of current HP (5e-style: absorbed
  // first, doesn't raise the max) — shown as "current(+temp)/max" so it
  // reads as HP added on top rather than folded invisibly into current.
  // Enforcing 5e's own stacking rule (temp doesn't stack, take-the-higher)
  // isn't this tracker's job — it just displays whatever the sheet (or a
  // GM's manual edit) currently says.
  function formatHpText(combatant) {
    const tempHp = Number(combatant.tempHp) || 0;
    const suffix = tempHp > 0 ? `(+${tempHp})` : "";
    return `${combatant.hp}${suffix}/${combatant.maxHp}`;
  }

  function renderCombatantRow(combatant, index) {
    const row = el("button", "list-group-item list-group-item-action d-flex justify-content-between align-items-center gap-2");
    row.type = "button";
    if (combatant.id === state.selectedCombatantId) row.classList.add("active");
    row.addEventListener("click", () => selectCombatant(combatant.id));

    const left = el("span", "d-flex align-items-center gap-2");
    if (state.encounter.started && index === state.encounter.activeIndex) left.appendChild(renderTurnBadge());
    left.appendChild(el("span", "fw-semibold", String(combatant.initiative)));
    left.appendChild(el("span", null, combatant.name));
    if (isCombatantHiddenFromPlayers(combatant)) left.appendChild(icon("tabler:eye-off"));

    const right = el("span", "d-flex align-items-center gap-2");
    right.appendChild(el("span", "text-body-secondary small", formatHpText(combatant)));
    right.appendChild(renderAcBadge(combatant));
    right.appendChild(renderCombatantTagBadges(combatant, { removable: false }));

    row.append(left, right);
    return row;
  }

  // Shown below the list whenever a combatant is selected — no separate
  // Edit button/toolbar; selecting a row IS opening its details. Visible
  // and Delete (previously a separate small toolbar above this panel) now
  // live in its header, next to the Name field.
  //
  // Built exactly ONCE per selected combatant identity (see refreshEditPanel
  // below) — every input handler here resolves selectedCombatant() fresh at
  // event time rather than closing over the `combatant` parameter directly,
  // since state.encounter (and so every combatant object inside it) can be
  // wholesale-replaced by a poll/sync refresh between when this panel was
  // built and when the GM actually commits an edit; reading fresh keeps the
  // write landing on the live object instead of a detached stale one.
  function buildEditPanel(combatant) {
    const panel = el("div", "border rounded-3 p-2 d-flex flex-column gap-2");

    const nameRow = el("div", "d-flex gap-2 align-items-center");
    nameRow.appendChild(el("label", "form-label small mb-0", "Name"));
    const nameInput = el("input", "form-control form-control-sm flex-grow-1");
    nameInput.value = combatant.name;
    nameInput.addEventListener("change", () => {
      const current = selectedCombatant();
      if (!current) return;
      current.name = nameInput.value.trim() || current.name;
      markDirty();
    });
    nameRow.appendChild(nameInput);
    // Icon/title/disabled state all get synced in place every render (see
    // syncEditPanelValues) — the values here just seed the very first paint
    // before that first sync runs a moment later.
    const visibleButton = iconButton(
      isCombatantHiddenFromPlayers(combatant) ? "tabler:eye-off" : "tabler:eye",
      "Visible to players"
    );
    visibleButton.addEventListener("click", toggleSelectedHidden);
    const deleteButton = iconButton("tabler:trash", "Delete combatant", "btn-outline-danger");
    deleteButton.addEventListener("click", deleteSelected);
    nameRow.append(visibleButton, deleteButton);

    // Labels come from the active System's own combatBindings entries (e.g.
    // a non-D&D System might call these "Reflexes"/"Stress"/"Defense"
    // instead of Init/HP/AC) — falling back to these generic names only
    // when a System hasn't configured combat bindings at all, since the
    // tracker still needs *some* label to show either way. Initiative
    // tracking itself always shows regardless (core turn-order feature,
    // independent of whether a System defines a "modifier" binding to
    // auto-roll it — see rollInitiativeForNonCharacters).
    const resourceBinding = findBindingByRole(state.combatBindings, "resource");
    const valueBinding = findBindingByRole(state.combatBindings, "value");
    const modifierBinding = findBindingByRole(state.combatBindings, "modifier");

    // Row 2: Initiative + AC together — the two "how this turn/hit goes"
    // numbers, as opposed to HP's own resource-tracking row below.
    const initAcRow = el("div", "d-flex gap-2 align-items-center flex-wrap");
    const initWrap = el("div", "d-flex align-items-center gap-1");
    initWrap.appendChild(el("span", "small text-body-secondary", modifierBinding?.name || "Init"));
    const initInput = el("input", "form-control form-control-sm");
    initInput.type = "number";
    initInput.style.width = "4.5rem";
    initInput.value = combatant.initiative;
    initInput.addEventListener("change", () => {
      const current = selectedCombatant();
      if (!current) return;
      current.initiative = Number(initInput.value) || 0;
      markDirty();
    });
    initWrap.appendChild(initInput);

    const acWrap = el("div", "d-flex align-items-center gap-1");
    acWrap.appendChild(el("span", "small text-body-secondary", valueBinding?.name || "Value"));
    const acInput = el("input", "form-control form-control-sm");
    acInput.type = "number";
    acInput.style.width = "4.5rem";
    acInput.value = combatant.ac ?? 0;
    acInput.addEventListener("change", () => {
      const current = selectedCombatant();
      if (!current) return;
      current.ac = Number(acInput.value) || 0;
      markDirty();
      void writeThroughToCharacter(current, { ac: current.ac });
    });
    acWrap.appendChild(acInput);

    initAcRow.append(initWrap, acWrap);

    // Row 3: current/max/temp HP and the ± delta box all together — every
    // number that describes "how hurt is this combatant right now" in one
    // place, separate from Init/AC above.
    // flex-nowrap + overflow-x-auto (not flex-wrap) — four number boxes plus
    // the delta box is too much to reliably fit one line at every dashboard
    // card width even at the reduced 3.5rem size below; scrolling sideways
    // beats the row breaking onto a second line and separating HP from the
    // ± box the GM actually wants right next to it. Same convention the Add
    // Combatant row already uses for the same reason.
    const hpRow = el("div", "d-flex align-items-center gap-1 flex-nowrap overflow-x-auto");
    hpRow.appendChild(el("span", "small text-body-secondary", resourceBinding?.name || "Resource"));
    const hpInput = el("input", "form-control form-control-sm");
    hpInput.type = "number";
    hpInput.style.width = "3.5rem";
    hpInput.value = combatant.hp;
    hpInput.addEventListener("change", () => {
      const current = selectedCombatant();
      if (!current) return;
      current.hp = Number(hpInput.value) || 0;
      markDirty();
      void writeThroughToCharacter(current, { hp: current.hp });
    });
    const maxHpInput = el("input", "form-control form-control-sm");
    maxHpInput.type = "number";
    maxHpInput.style.width = "3.5rem";
    maxHpInput.value = combatant.maxHp;
    maxHpInput.addEventListener("change", () => {
      const current = selectedCombatant();
      if (!current) return;
      current.maxHp = Number(maxHpInput.value) || 0;
      markDirty();
      void writeThroughToCharacter(current, { maxHp: current.maxHp });
    });
    const tempHpInput = el("input", "form-control form-control-sm");
    tempHpInput.type = "number";
    tempHpInput.style.width = "3.5rem";
    tempHpInput.value = combatant.tempHp ?? 0;
    tempHpInput.addEventListener("change", () => {
      const current = selectedCombatant();
      if (!current) return;
      current.tempHp = Number(tempHpInput.value) || 0;
      markDirty();
      void writeThroughToCharacter(current, { tempHp: current.tempHp });
    });
    // "Remove HP" — a delta box, not a value box: type a positive number to
    // subtract it from current HP, or a negative number to add it back
    // (heal). The sign is deliberately inverted from what a plain "+/- HP"
    // box would do — per the user, most entries during a real session are
    // damage, so making the common case not require typing a leading "-"
    // every time is the point, not an accident. Always clears back to blank
    // after applying so it's immediately ready for the next hit, and never
    // reflects any persisted value itself (see syncEditPanelValues, which
    // skips it on purpose).
    const hpDeltaInput = el("input", "form-control form-control-sm");
    hpDeltaInput.type = "number";
    hpDeltaInput.style.width = "4.5rem";
    hpDeltaInput.placeholder = "±HP";
    hpDeltaInput.title = "Remove this much HP — type a negative number to heal instead";
    hpDeltaInput.setAttribute("aria-label", "Remove HP");
    hpDeltaInput.setAttribute("data-bs-toggle", "tooltip");
    hpDeltaInput.addEventListener("change", () => {
      const amount = Number(hpDeltaInput.value);
      hpDeltaInput.value = "";
      if (!amount) return;
      const current = selectedCombatant();
      if (!current) return;
      current.hp -= amount;
      markDirty();
      void writeThroughToCharacter(current, { hp: current.hp });
    });
    hpRow.append(
      hpInput,
      el("span", "text-body-secondary", "/"),
      maxHpInput,
      el("span", "small text-body-secondary ms-1", "Temp"),
      tempHpInput,
      hpDeltaInput
    );

    // Row 4: current tag badges on the left (badgesMount — rebuilt fresh
    // every sync, same as before, since a badge/remove-button has no value
    // a GM sits typing into), the Add Tag input+visibility-toggle+Add
    // button on the right (addTagRow) — built ONCE here, like nameInput/
    // hpInput/visibleButton above, and only ever SYNCED in place afterward
    // (see syncEditPanelValues). This used to also be rebuilt every sync —
    // confirmed real bug that caused: typing getting wiped mid-keystroke by
    // an unrelated render, and (once the visibility toggle was added)
    // clicking that toggle moving focus off the input and losing the SAME
    // protection a moment later. Making this row stable, exactly like every
    // other input on this panel, removes the whole class of bug rather than
    // chasing each new way to trigger it.
    const tagsRow = el("div", "d-flex align-items-center justify-content-between gap-2 flex-wrap");
    const badgesMount = el("div", "flex-grow-1");
    const { row: addTagRow, visibilityButton: tagVisibilityButton } = buildTagInputRow(TAG_DATALIST_ID, {
      onAdd: (value) => {
        const current = selectedCombatant();
        const hidden = pendingTagHidden;
        pendingTagHidden = false;
        if (current) addTag(current, value, hidden);
      },
      onToggleHidden: () => {
        pendingTagHidden = !pendingTagHidden;
        render();
      },
    });
    addTagRow.classList.add("flex-shrink-0");
    tagsRow.append(badgesMount, addTagRow);
    panel.append(nameRow, initAcRow, hpRow, tagsRow);

    return {
      combatantId: combatant.id,
      panel,
      nameInput,
      initInput,
      hpInput,
      maxHpInput,
      tempHpInput,
      acInput,
      visibleButton,
      badgesMount,
      tagVisibilityButton,
    };
  }

  // Pushes `combatant`'s current values into an already-built panel's
  // inputs — never recreates a single DOM node. Skips whichever input is
  // `document.activeElement`, so a render triggered by anything else (a
  // poll/sync tick, a different combatant's HP changing) can't overwrite an
  // edit the GM is mid-typing into. hpDeltaInput is deliberately excluded —
  // it never represents persisted state, only a transient action.
  function syncEditPanelValues(refs, combatant) {
    const active = document.activeElement;
    if (active !== refs.nameInput) refs.nameInput.value = combatant.name;
    if (active !== refs.initInput) refs.initInput.value = combatant.initiative;
    if (active !== refs.hpInput) refs.hpInput.value = combatant.hp;
    if (active !== refs.maxHpInput) refs.maxHpInput.value = combatant.maxHp;
    if (active !== refs.tempHpInput) refs.tempHpInput.value = combatant.tempHp ?? 0;
    if (active !== refs.acInput) refs.acInput.value = combatant.ac ?? 0;

    // Needed to resolve whether THIS combatant has a linked marker on the
    // active map at all, and if so whether it's currently hidden — see
    // isCombatantHiddenFromPlayers' own header comment for why this reads
    // live from Orrery's own Map/View data instead of a stored
    // combatant.hidden field.
    ensureActiveMapCached(() => render());
    const activeMap = getCachedActiveMap();
    // "Hidden from players" is only ever meaningful once a map is actually
    // being shown to players at all — before that, everything on every map
    // is effectively hidden already, spotlight or not. Distinguishing WHY
    // there's nothing to toggle matters here: "no map is currently shown to
    // the table" (an ordinary, common prep-time state — nothing wrong with
    // the combatant's own setup) reads very differently from "this specific
    // combatant isn't placed on the map that IS being shown" (an actual
    // setup gap worth fixing). Conflating the two into one generic message
    // was confirmed genuinely confusing — it read as "your marker is wrong"
    // when the real reason was just "you haven't clicked Show to Table yet."
    const hasActiveMap = Boolean(activeMap?.id);
    const linkedMarkerCount = resolveCombatantMarkers(combatant, activeMap).length;
    const hiddenFromPlayers = isCombatantHiddenFromPlayers(combatant);
    const visibleIcon = refs.visibleButton.querySelector(".iconify");
    if (visibleIcon) visibleIcon.dataset.icon = hiddenFromPlayers ? "tabler:eye-off" : "tabler:eye";
    // Disabled (not hidden entirely) when this combatant has no linked
    // marker on the active map right now — same "absent/inert rather than
    // a fake no-op control" treatment the Linked Combatant picker already
    // gives an inapplicable state, just disabled instead of absent since
    // this button's OWN row (Name/Visible/Delete) always needs to exist.
    // A real `disabled` attribute blocks hover entirely, so the
    // explanation for WHY has to live on setDisabledTooltip's own wrapper,
    // not on this button directly — see tooltips.js's own header for why
    // the previous same-element version of this never actually showed a
    // tooltip while disabled.
    const blockedTitle = !hasActiveMap
      ? "No map is shown to the table or open on your dashboard — nothing to show/hide yet"
      : !linkedMarkerCount
        ? "Not placed on the active map — nothing to show/hide"
        : "";
    const readyTitle = hiddenFromPlayers ? "Hidden from players — click to reveal" : "Visible to players — click to hide";
    refs.visibleButton.setAttribute("aria-label", blockedTitle || readyTitle);
    setDisabledTooltip(refs.visibleButton, blockedTitle);
    if (!blockedTitle) initTooltip(refs.visibleButton, { title: readyTitle });

    // Badges have no value a GM sits typing into (buttons + static labels),
    // so it's safe (and simplest) to rebuild this fresh every sync rather
    // than diffing — same reasoning as before, just narrowed to ONLY this
    // mount now. The Add Tag input/visibility-toggle/Add button are no
    // longer rebuilt at all — they're built ONCE in buildEditPanel (like
    // nameInput/hpInput/visibleButton above) and only ever synced in place,
    // via applyTagVisibilityState just below — the exact same pattern
    // visibleButton itself already uses successfully, one call up. This
    // replaced an earlier "rebuild the whole row every sync, but skip it
    // while X is focused" guard: that approach kept needing a new exemption
    // every time a new interactive element (the visibility toggle) was
    // added to the row, and broke again each time the exemption's own
    // query hook changed. Making the row genuinely stable removes the bug
    // class instead of chasing its next instance.
    refs.badgesMount.innerHTML = "";
    refs.badgesMount.appendChild(renderCombatantTagBadges(combatant, { removable: true }));
    applyTagVisibilityState(refs.tagVisibilityButton, pendingTagHidden);

    refreshTooltips(refs.panel);
  }

  // Creates every persistent mount exactly once (a no-op every call after
  // the first) — see their own declaration comment for why the split
  // exists. Called from renderGm() itself rather than init(), so it's
  // naturally never reached in player mode at all.
  function ensureGmShell() {
    if (topBarMount) return;
    container.innerHTML = "";
    const root = el("div", "combat-tracker-widget d-flex flex-column gap-2");

    // No individual mt-2/spacing classes needed on any of these — they're
    // all direct children of `root`'s own gap-2 flex column now (unlike the
    // old addRowMount, a sibling of the whole rebuilt tree rather than a
    // child within it, which needed its own margin for exactly that reason).
    // gap-2 only applies between children actually in layout, so a hidden
    // (d-none) mount correctly contributes no extra blank space.
    topBarMount = el("div");
    toolbarMount = el("div", "d-flex flex-wrap gap-3 align-items-center justify-content-end d-none");
    emptyStateMount = el("p", "text-body-secondary small mb-0", "Select or create an encounter to start tracking combat.");
    listMount = el("div", "list-group d-none");
    // Deliberately NOT appended to `root` here — it's relocated dynamically,
    // inline into listMount right after whichever row is currently
    // selected (see refreshCombatantList's own comment), not a fixed
    // section of its own anymore. Still created once, up front, so
    // refreshEditPanel always has a stable node to build/sync into
    // regardless of whether it's attached anywhere at the moment.
    editPanelMount = el("div");
    // Starts hidden — toggled per-render below, same "only show once an
    // encounter is selected" behavior this row always had, just via a class
    // now instead of being present/absent.
    addRowMount = el("div", "d-none");
    addRowMount.appendChild(renderGmAddCombatantRow());

    root.append(topBarMount, toolbarMount, emptyStateMount, listMount, addRowMount);
    container.appendChild(root);
  }

  // Rebuilds topBarMount's actual DOM only when what it depends on
  // (the owned-encounter list, the systems list, which encounter/system are
  // current) has actually changed since the last render — see topBarMount's
  // declaration comment for why this matters. Cheap to call on every render;
  // the signature check is what keeps it from touching the DOM (and so the
  // Encounter/System selects) on renders that have nothing to do with them.
  function refreshTopBar() {
    const signature = JSON.stringify({
      encounters: state.ownedEncounters.map((entry) => [entry.id, entry.title || entry.name]),
      systems: (state.systemsList || []).map((entry) => entry.id),
      encounterId: state.encounter?.id || "",
      systemId: state.encounter?.systemId || "",
    });
    if (signature === lastTopBarSignature) return;
    lastTopBarSignature = signature;
    disposeTooltips(topBarMount);
    topBarMount.innerHTML = "";
    topBarMount.appendChild(buildTopBarRow());
    refreshTooltips(topBarMount);
  }

  // Same signature-gated approach as refreshTopBar, for the round readout +
  // start/stop/turn/sort/roll/delete buttons.
  function refreshToolbar() {
    const signature = JSON.stringify({ started: state.encounter?.started, round: state.encounter?.round });
    if (signature === lastToolbarSignature) return;
    lastToolbarSignature = signature;
    disposeTooltips(toolbarMount);
    toolbarMount.innerHTML = "";
    if (state.encounter.started) {
      toolbarMount.appendChild(el("span", "text-body-secondary small", `Round ${state.encounter.round}`));
    }
    toolbarMount.appendChild(renderEncounterToolbar());
    refreshTooltips(toolbarMount);
  }

  // Rebuilt in full on most renders — combatant ROWS have no free-text
  // inputs of their own, so that's exactly what a GM wants reflecting a
  // poll/sync tick live (same reasoning this always had). That stopped
  // being unconditionally true the moment editPanelMount started living
  // INLINE here (see its own declaration comment) instead of as a separate
  // section below the list — it DOES have free-text inputs (Name/Init/HP/
  // AC/tags), and rebuilding via innerHTML="" detaches whatever's currently
  // focused inside it, then re-inserts it moments later once row-building
  // finishes — a real gap (not an atomic move) during which the browser
  // reliably fires blur, exactly the same class of "typing gets interrupted
  // by an unrelated render" bug already fixed elsewhere in this file (the
  // tag input, the visibility toggle) for the identical reason. Skipping
  // the whole rebuild while focus is inside editPanelMount closes it the
  // same way: refreshEditPanel (called before this, in renderGm) already
  // handles syncing/tearing down editPanelMount's own CONTENT on its own,
  // independent of whether this function touches its POSITION at all — a
  // deselect/delete moves focus itself (removing/replacing what was
  // focused) before this check runs, so that case still updates
  // immediately; only "still editing the SAME combatant" is deferred here,
  // same as everywhere else this pattern is used.
  function refreshCombatantList() {
    if (editPanelMount.contains(document.activeElement)) return;
    disposeTooltips(listMount);
    listMount.innerHTML = "";
    state.encounter.combatants.forEach((combatant, index) => {
      listMount.appendChild(renderCombatantRow(combatant, index));
      // Inline expansion — right after the row it belongs to, not a fixed
      // section at the bottom anymore. editPanelRefs (not just
      // state.selectedCombatantId) is the source of truth for "is this
      // panel actually built and ready" — refreshEditPanel is what
      // maintains it, called before this in renderGm.
      if (editPanelRefs?.combatantId === combatant.id) {
        listMount.appendChild(editPanelMount);
      }
    });
    if (!state.encounter.combatants.length) {
      listMount.appendChild(el("p", "text-body-secondary small mb-0", "No combatants yet."));
    }
    refreshTooltips(listMount);
  }

  // Rebuilds editPanelMount's DOM only when the SELECTED COMBATANT ITSELF
  // changes (a real structural change); otherwise pushes fresh values into
  // the already-built inputs via syncEditPanelValues, which itself skips
  // whichever input currently has focus — see editPanelRefs' declaration
  // comment and buildEditPanel's own comment for the full reasoning.
  function refreshEditPanel() {
    const combatant = selectedCombatant();
    if (!combatant) {
      if (editPanelRefs) {
        disposeTooltips(editPanelMount);
        editPanelMount.innerHTML = "";
        editPanelRefs = null;
      }
      return;
    }
    if (!editPanelRefs || editPanelRefs.combatantId !== combatant.id) {
      disposeTooltips(editPanelMount);
      editPanelMount.innerHTML = "";
      editPanelRefs = buildEditPanel(combatant);
      editPanelMount.appendChild(editPanelRefs.panel);
      // A toggle left on for a tag that never got added shouldn't silently
      // carry over to a DIFFERENT combatant's own Add Tag row.
      pendingTagHidden = false;
    }
    syncEditPanelValues(editPanelRefs, combatant);
  }

  // Synchronous, and touches only whichever mounts actually need it this
  // render — see each mount's own declaration/refresh-function comment.
  function renderGm() {
    ensureGmShell();
    const hasEncounter = Boolean(state.encounter);

    emptyStateMount.classList.toggle("d-none", hasEncounter);
    toolbarMount.classList.toggle("d-none", !hasEncounter);
    listMount.classList.toggle("d-none", !hasEncounter);
    addRowMount.classList.toggle("d-none", !hasEncounter);

    refreshTopBar();
    if (hasEncounter) {
      // Needed by refreshCombatantList's own eye-off row badge below, and
      // by refreshEditPanel's own "Visible to players" toggle — see
      // isCombatantHiddenFromPlayers' own header comment for why this reads
      // live from Orrery's own Map/View data instead of a stored
      // combatant.hidden field.
      ensureActiveMapCached(() => render());
      refreshToolbar();
      // refreshEditPanel BEFORE refreshCombatantList, not after — two
      // reasons, both load-bearing: (1) refreshEditPanel's own teardown
      // when a combatant gets deselected/deleted (editPanelMount.innerHTML =
      // "") removes whatever was focused inside it as a side effect,
      // BEFORE refreshCombatantList's own "skip while focused" guard runs —
      // reversed, that guard would see the just-deleted combatant's own
      // Delete button (about to be torn down) as still "focused" and
      // incorrectly skip updating the list to reflect the deletion. (2) by
      // the time refreshCombatantList re-inserts editPanelMount inline, its
      // own content (and tooltips) are already fresh, not stale-then-
      // immediately-redone.
      refreshEditPanel();
      refreshCombatantList();
    } else if (editPanelRefs) {
      disposeTooltips(editPanelMount);
      editPanelMount.innerHTML = "";
      editPanelRefs = null;
    }

    // Was unconditional every renderGm() call — i.e. every poll/sync tick,
    // completely unrelated to conditions ever changing — which rebuilds the
    // shared <datalist>'s own <option> elements out from under the browser
    // while its native suggestion popup is open. Confirmed real bug: that's
    // exactly what made the "Add a tag" autocomplete list keep disappearing
    // mid-use. renderTagDatalist only actually needs to run again when
    // state.conditions itself changed (see lastConditionsRendered's own
    // comment) — everything else this function does each render is
    // unrelated to what's IN that list.
    if (state.conditions !== lastConditionsRendered) {
      renderTagDatalist(TAG_DATALIST_ID, state.conditions);
      lastConditionsRendered = state.conditions;
    }
    updateVisibilityAction();
  }

  // A rough, numeric-free read on how hurt a non-PC combatant is — players
  // never see a monster/NPC's actual HP numbers, just this. Full health
  // renders no badge at all (nothing to report), matching the existing
  // "only show temp HP when it's non-zero" convention elsewhere in this row.
  function describeMonsterCondition(hp, maxHp) {
    if (hp <= 0) return "Unconscious";
    if (maxHp > 0 && hp / maxHp <= 0.5) return "Bleeding";
    if (hp < maxHp) return "Hurt";
    return "";
  }

  // "Character 1"/"NPC 1"/"Monster 1" — reuses REF_KIND_LABELS (already the
  // suite's own Character/NPC/Monster vocabulary, see buildCombatantEntries
  // above) rather than a new label set. `hiddenCombatants` is every
  // currently-hidden combatant in the encounter, in render order — N is this
  // one's ordinal among just the others sharing its own kind, so two hidden
  // Characters and one hidden Monster read "Character 1"/"Character 2"/
  // "Monster 1", not sharing one counter across kinds. Computed fresh every
  // render, never stored, same reasoning as everywhere else names get
  // numbered in this suite.
  function anonymizedCombatantLabel(combatant, hiddenCombatants) {
    const kind = REF_KIND_LABELS[combatant.refKind] || "Monster";
    const ordinal = hiddenCombatants.filter((c) => (REF_KIND_LABELS[c.refKind] || "Monster") === kind).indexOf(combatant) + 1;
    return `${kind} ${ordinal}`;
  }

  function renderPlayerCombatantRow(combatant, index, hiddenCombatants) {
    const row = el("div", "list-group-item d-flex justify-content-between align-items-center gap-2");
    const left = el("span", "d-flex align-items-center gap-2");
    if (state.encounter.started && index === state.encounter.activeIndex) left.appendChild(renderTurnBadge());
    left.appendChild(el("span", "fw-semibold", String(combatant.initiative)));
    left.appendChild(
      el("span", null, isCombatantHiddenFromPlayers(combatant) ? anonymizedCombatantLabel(combatant, hiddenCombatants) : combatant.name)
    );
    const right = el("span", "d-flex align-items-center gap-2");
    if (combatant.isPc) {
      right.appendChild(el("span", "text-body-secondary small", formatHpText(combatant)));
    } else {
      const condition = describeMonsterCondition(combatant.hp, combatant.maxHp);
      if (condition) right.appendChild(el("span", "text-body-secondary small", condition));
    }
    right.appendChild(renderCombatantTagBadges(combatant, { removable: false }));
    row.append(left, right);
    return row;
  }

  function renderPlayer() {
    container.innerHTML = "";
    const root = el("div", "combat-tracker-widget d-flex flex-column gap-2");
    if (!state.encounter) {
      root.appendChild(el("p", "text-body-secondary small mb-0", "No combat is currently active."));
      container.appendChild(root);
      return;
    }
    const header = el("div", "d-flex align-items-center gap-2");
    header.appendChild(el("span", "fw-semibold", state.encounter.name));
    if (state.encounter.started) {
      header.appendChild(el("span", "text-body-secondary small", `Round ${state.encounter.round}`));
    }
    root.appendChild(header);

    // Needed for isCombatantHiddenFromPlayers below — see that function's
    // own header comment for why player mode reads this live too, instead
    // of a stored combatant.hidden field.
    ensureActiveMapCached(() => render());
    const list = el("div", "list-group");
    const hiddenCombatants = state.encounter.combatants.filter((c) => isCombatantHiddenFromPlayers(c));
    state.encounter.combatants.forEach((combatant, index) => {
      list.appendChild(renderPlayerCombatantRow(combatant, index, hiddenCombatants));
    });
    root.appendChild(list);
    container.appendChild(root);
  }

  function render() {
    if (state.destroyed) return;
    if (mode === "gm") {
      renderGm();
    } else {
      renderPlayer();
    }
  }

  async function init() {
    if (mode === "gm") {
      await Promise.all([loadOwnedEncounters(), loadSystemsList(), loadCombatantEntityLists()]);
      if (encounterId) {
        await selectEncounter(encounterId);
        if (!state.encounter) {
          // The deep-linked encounter (?encounter=<id> — see dashboard.js's
          // own encounterParam) no longer exists, e.g. deleted since the
          // link was made. selectEncounter already surfaced a toast; this
          // just stops that same dead reference from re-triggering (and
          // re-toasting) on every future reload of this same dashboard tab.
          const url = new URL(window.location.href);
          url.searchParams.delete("encounter");
          window.history.replaceState(null, "", url);
        }
      } else {
        // Resume whatever's actually still being shown to the table, if
        // anything — without this, a plain page refresh (no ?encounter=
        // deep link) always started with NOTHING selected, even though the
        // server-side spotlight itself is untouched by the GM's own browser
        // reloading. Confirmed bug this fixes: after a refresh, the GM's own
        // tracker showed "no active encounter" while the second screen (and
        // every player's own dashboard, which both read the same spotlight,
        // not this widget's local state) correctly kept showing the
        // still-running encounter — the two views disagreeing about
        // something that was never actually stopped.
        const activeId = groupId
          ? await resolveActiveSpotlightId(dataManager, { groupId, shareToken, kind: "encounter" }).catch(() => "")
          : "";
        if (activeId) {
          await selectEncounter(activeId);
          // Confirmed via the spotlight resolution above — selectEncounter
          // itself always resets this to false at its own start, since it
          // has no way to know WHY an id was selected; this is the one
          // caller that does know, because resolving to this id at all
          // means it's currently being shown.
          if (state.encounter) state.announced = true;
        }
        render();
      }
      startGmCharacterSync();
    } else {
      await pollActiveEncounter();
      startPolling();
    }
    startLiveStream();
  }

  void init();

  return {
    // No per-instance show/hide toggle of its own the way Clock/Calendar
    // have (Combat Tracker is multiple: false — only one instance can ever
    // exist on a dashboard at all) — always true once mounted. Needed
    // purely so dashboard.js's own findActiveWidgetInstance("combat") can
    // find this instance at all (its own isVisible gate, shared with Clock/
    // Calendar/WLED/Soundboard) — see the "map" widget's own identical
    // isVisible for the sibling half of this same cross-widget wiring.
    isVisible: () => true,
    // Called by the Map widget (via dashboard.js's own
    // findActiveWidgetInstance("combat")) when its own map owner clicks a
    // linked marker — selects the matching combatant here too, the same
    // refKind+refId(+linkedCombatantId-when-ambiguous) matching
    // map-viewer.js's own resolveMarkerLinkedCombatant already uses, just
    // run against this widget's own live state.encounter instead of a
    // fetched copy. GM mode only (a player has no business driving this
    // widget's own selection from a marker click); no-op (returns false,
    // not an error) when there's no encounter loaded, or no unambiguous
    // match — same "absent rather than guessing" treatment the Linked
    // Combatant picker itself already applies to the identical ambiguity.
    selectCombatantByRef(refKind, refId, linkedCombatantId) {
      if (mode !== "gm" || !state.encounter) return false;
      const matches = state.encounter.combatants.filter(
        (combatant) => combatant.refKind === refKind && combatant.refId === refId
      );
      let combatant = null;
      if (matches.length === 1) {
        combatant = matches[0];
      } else if (matches.length > 1 && linkedCombatantId) {
        combatant = matches.find((entry) => entry.id === linkedCombatantId) || null;
      }
      if (!combatant) return false;
      state.selectedCombatantId = combatant.id;
      render();
      return true;
    },
    // `removed` (dashboard.js's removeWidget passes true) — this instance's
    // own "show to table" spotlight, if it announced one, needs clearing.
    // Confirmed real bug this fixes: unlike handout.js/map.js/clocks.js
    // (each keyed by a single per-instance `visible` flag this widget has
    // no equivalent of — GM/player share the same widget shape here, mode
    // decided live from groupContext.access, not a per-instance toggle),
    // this widget never cleared its own spotlight on removal at all — a GM
    // removing their Combat Tracker widget while an encounter was shown left
    // that encounter permanently stuck "active" in the group log, with no
    // way to turn it off short of a server-side fix. `state.announced`
    // (set by showToTable/cleared by hideFromTable, GM mode only) is this
    // widget's own equivalent of that missing `visible` flag.
    async destroy(removed) {
      state.destroyed = true;
      stopPolling();
      stopGmCharacterSync();
      liveStream?.close();
      container.innerHTML = "";
      if (removed && mode === "gm" && state.announced && state.encounter && groupId) {
        try {
          await dataManager.clearSpotlight({ groupId, kind: "encounter", id: state.encounter.id });
        } catch (error) {
          // Best-effort cleanup — nothing meaningful to do if this fails.
        }
      }
    },
  };
}

// --- Macro action support (common/js/lib/widgets/macro-runner.js) ---
// Standalone — no mounted Combat Tracker widget instance required. Each
// call does its own fetch → mutate → save round trip against the real
// "encounter" Library record (preferLocal:false, same reasoning the live
// widget's own save/writeThroughToCharacter already document: this has to
// see whatever's actually on the server right now, not a stale local
// cache), rather than reusing the widget's own in-memory `state.encounter`
// — there may be no live widget mounted anywhere on this dashboard at all.

export const COMBAT_MACRO_ACTIONS = {
  advanceTurn: { label: "Advance turn", params: ["delta"] },
  start: { label: "Start combat" },
  stop: { label: "Stop combat" },
  show: { label: "Show to table" },
  hide: { label: "Hide from table" },
  addCombatant: { label: "Add a combatant", params: ["refKind", "refId", "name"] },
  rollInitiative: { label: "Roll initiative (non-characters)" },
};

// `target` is either a real encounter id, or "active" (the literal string)
// — resolved dynamically via resolveActiveSpotlightId against whichever
// encounter is currently spotlighted to the group, exactly like the
// player-mode poll above already does. Never a specific widget instance id
// — see macro-runner.js's own design notes on why Clock/Calendar can't do
// the same and need Phase 2 instead.
async function resolveMacroEncounterId(target, { dataManager, groupContext }) {
  const trimmed = (target || "").trim();
  if (trimmed && trimmed.toLowerCase() !== "active") return trimmed;
  return resolveActiveSpotlightId(dataManager, { groupId: groupContext?.groupId, kind: "encounter" });
}

async function loadMacroEncounter(id, dataManager) {
  const result = await dataManager.get("encounter", id, { preferLocal: false });
  const encounter = result?.payload;
  if (!encounter || !Array.isArray(encounter.combatants)) {
    throw new Error(`Encounter "${id}" not found.`);
  }
  encounter.id = id;
  return encounter;
}

export async function runCombatMacroAction(action, { dataManager, groupContext, status } = {}) {
  const encounterId = await resolveMacroEncounterId(action?.target, { dataManager, groupContext });
  if (!encounterId) {
    throw new Error("No encounter to target (none currently shown to the table, and no specific id given).");
  }
  const actionName = action?.action;
  const params = action?.params || {};

  if (actionName === "show" || actionName === "hide") {
    const groupId = groupContext?.groupId;
    if (!groupId) throw new Error("No active campaign to show/hide this to.");
    if (actionName === "show") {
      await dataManager.spotlightToGroup({ groupId, contentType: "encounter", contentId: encounterId });
    } else {
      await dataManager.clearSpotlight({ groupId, kind: "encounter", id: encounterId });
    }
    return;
  }

  const encounter = await loadMacroEncounter(encounterId, dataManager);

  if (actionName === "advanceTurn") {
    if (!encounter.combatants.length) return;
    const delta = Number(params.delta) || 1;
    const count = encounter.combatants.length;
    let next = encounter.activeIndex + delta;
    if (next >= count) {
      next = 0;
      encounter.round += 1;
    } else if (next < 0) {
      next = count - 1;
      encounter.round = Math.max(1, encounter.round - 1);
    }
    encounter.activeIndex = next;
  } else if (actionName === "start") {
    encounter.started = true;
    encounter.round = 1;
    encounter.activeIndex = 0;
  } else if (actionName === "stop") {
    encounter.started = false;
  } else if (actionName === "addCombatant") {
    let resolvedName = params.name;
    let stats = { hp: 0, maxHp: 0, tempHp: 0, ac: 0 };
    let combatBindings = null;
    if (params.refKind && params.refId) {
      try {
        const result = await dataManager.get(params.refKind, params.refId, { preferLocal: false });
        const payload = result.payload || {};
        if (!resolvedName) resolvedName = payload.name || payload.title || params.refId;
        const fields = await loadSystemFields(dataManager, encounter.systemId);
        combatBindings = deriveCombatBindings(fields);
        stats = resolveCombatantStats(combatBindings, payload);
      } catch (error) {
        resolvedName = resolvedName || params.refId;
      }
    }
    encounter.combatants.push({
      id: randomId(),
      name: uniquifyCombatantName(resolvedName || "Combatant", encounter.combatants),
      refKind: params.refKind || null,
      refId: params.refId || null,
      initiative: 0,
      hp: stats.hp,
      maxHp: stats.maxHp,
      tempHp: stats.tempHp,
      ac: stats.ac,
      conditions: [],
      hiddenTags: [],
      isPc: params.refKind === "character",
    });
  } else if (actionName === "rollInitiative") {
    const targets = encounter.combatants.filter((c) => c.refKind !== "character");
    if (targets.length) {
      const fields = await loadSystemFields(dataManager, encounter.systemId);
      const combatBindings = deriveCombatBindings(fields);
      const modifierEntry = findBindingByRole(combatBindings, "modifier");
      const modifierPath = modifierEntry?.binding;
      const sides = Number(String(modifierEntry?.die || "d20").replace(/^d/i, "")) || 20;
      await Promise.all(
        targets.map(async (combatant) => {
          let modifier = 0;
          if (modifierPath && combatant.refKind && combatant.refId) {
            try {
              const result = await dataManager.get(combatant.refKind, combatant.refId, { preferLocal: false });
              const resolved = Number(resolveBinding(modifierPath, result.payload || {}));
              if (Number.isFinite(resolved)) modifier = resolved;
            } catch (error) {
              // Fall back to +0 — same as the live widget's own version.
            }
          }
          combatant.initiative = rollDiceExpression(`1d${sides}`).total + modifier;
        })
      );
    }
  } else {
    throw new Error(`Unknown Combat Tracker macro action "${actionName}".`);
  }

  const { id: _id, ...body } = encounter;
  await dataManager.save("encounter", encounter.id, body);
}
