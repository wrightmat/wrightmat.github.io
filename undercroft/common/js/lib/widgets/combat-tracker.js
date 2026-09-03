// Combat/initiative tracker — the GM half authors an "encounter" Library
// record (readTier: free, writeTier: gm — see
// undercroft/common/data/kind/encounter.json) and the player half polls it
// read-only. Built as a mountable widget (not a page of its own) because
// combat tracking is party/session-scoped, not character-scoped like
// Workbench's view-switcher, and doesn't belong to any one existing tool —
// see the Dashboard plan this widget was built for.
import { resolveActiveSpotlightId, resolveSpotlightData } from "../spotlight.js";
import { disposeTooltips, refreshTooltips, setDisabledTooltip, initTooltip } from "../tooltips.js";
import { resolveBinding, setAtBinding, findBindingByRole, findBindingsByRole } from "../bindings.js";
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
// The shared dice engine, not rollExpression's overlay/toast wrapper — this
// rolls potentially many non-character combatants' initiative in one
// Promise.all batch, which a single shared 3D overlay canvas isn't
// designed to show all at once, so this stays a plain, silent roll.
import { rollDiceExpression } from "../../../../workbench/js/lib/dice.js";
// Cross-tool import — reuses the real shape a Map's own data uses rather
// than a hand-rolled copy. Needed for isCombatantHiddenFromPlayers' own
// write-through to a Map's auto-managed View.
import { createView } from "../../../../orrery/js/lib/map-model.js";

const POLL_INTERVAL_MS = 5000; // a physical second-screen display wants combat to feel live

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
    // spotlight-first, this-second resolution order. dashboard.js's caller
    // supplies this from a live sibling Map widget; omitted in player mode
    // and gracefully absent elsewhere — purely a prep convenience.
    resolveActiveMapId,
  } = {}
) {
  if (!container || !dataManager) {
    return { destroy() {} };
  }

  // GM mode only — see ensureGmShell/renderGm's own comments. Permanent
  // children of `container`, created once and never torn down as elements:
  // `topBarMount` (New Encounter + Encounter/System selects), `toolbarMount`
  // (round readout + start/stop/turn/sort/roll/delete), `listMount` (the
  // combatant list — the ONE region rebuilt every render, since rows have
  // no focus to lose), `editPanelMount` (the selected combatant's fields),
  // `addRowMount` (Add Combatant), `emptyStateMount`.
  //
  // topBarMount/toolbarMount only rebuild their DOM when the data they
  // depend on actually changes between renders (see refreshTopBar/
  // refreshToolbar's own signature checks), and editPanelMount only
  // rebuilds when the SELECTED COMBATANT ITSELF changes — an unrelated
  // render (a different combatant's HP changing, a poll tick) just pushes
  // fresh values into the existing, still-focused inputs via
  // syncEditPanelValues, skipping whichever is `document.activeElement` so
  // an in-progress edit is never overwritten from under the GM. Confirmed
  // real bug this fixes: without this, the GM lost input focus in Name/HP/AC while editing.
  let topBarMount = null;
  let toolbarMount = null;
  let listMount = null;
  let editPanelMount = null;
  let addRowMount = null;
  let emptyStateMount = null;
  // Cheap "did the inputs to this region actually change since last render" guards.
  let lastTopBarSignature = "";
  let lastToolbarSignature = "";
  // Reference (not deep) equality is enough — state.conditions is only
  // reassigned to a NEW array when the System's condition vocabulary is
  // actually (re)resolved, never as a side effect of a routine poll/sync tick.
  let lastConditionsRendered = null;
  // {combatantId, panel, nameInput, initInput, hpInput, maxHpInput,
  // tempHpInput, acInput, visibleButton, badgesMount, tagVisibilityButton,
  // tagVisibilityIcon} for whichever combatant editPanelMount currently shows — null when nothing's selected.
  let editPanelRefs = null;
  // Ephemeral UI-only state for the Add Tag row's visibility toggle —
  // whether the NEXT tag added should be suppressed from map marker badges.
  // Lives here, not on any combatant, since it's pre-commit state shared
  // across whichever combatant is selected; its resolved value lives on
  // Orrery's own Map data instead (see isCombatantHiddenFromPlayers below).
  let pendingTagHidden = false;

  const state = {
    encounter: null,
    conditions: null,
    combatBindings: null,
    ownedEncounters: [],
    pollTimer: 0,
    // GM mode's own safety-net sync sweep (see startGmCharacterSync) — a
    // separate timer from pollTimer above: player mode polls the active
    // encounter; this re-syncs each PC combatant from its live character
    // record regardless of whether the live-stream subscription delivered.
    gmSyncTimer: 0,
    destroyed: false,
    selectedCombatantId: "",
    // Loaded once and cached — renderGm() reads this synchronously so a
    // click-driven re-render never awaits a network fetch (that gap caused
    // the widget to visibly flash empty on every interaction).
    systemsList: null,
    // Same reasoning as systemsList — the Add Combatant row's cascading
    // kind+entity select reads this directly rather than re-fetching on
    // every re-render (this widget re-renders on nearly every interaction via markDirty).
    combatantEntityLists: null,
    // Purely a local "is this encounter shown to the table" indicator for
    // the play/stop button — there's no backend "unspotlight" call, so
    // "stop" just resets this local flag.
    announced: false,
  };

  // "Visible to players" no longer has its own combatant.hidden field —
  // it's derived live from whichever marker on the campaign's active/
  // spotlighted MAP represents this combatant, the same "read live, don't
  // keep a shadow copy" precedent resolveMarkerConditionIcons established.
  // Here the direction is reversed — Combat Tracker reads FROM Orrery's own
  // Map/View data — but the principle is the same: exactly one place owns
  // this fact (Orrery's View.hiddenElementIds), so the two surfaces can
  // never quietly drift the way a second, independently-toggled flag would.
  // Fetch-once-then-stale, same shape as the active encounter cache below —
  // a live-stream subscription to the "map" kind wakes this up sooner.
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
        // Spotlighted (actually shown to players) takes priority — the
        // definitive, group-wide active map, which is all player mode can
        // ever see. resolveActiveMapId is the GM-only fallback for
        // "prepping before showing anything to the table yet."
        const mapId = (await resolveActiveSpotlightId(dataManager, { groupId, kind: "map" })) || resolveActiveMapId?.() || "";
        if (!mapId) {
          // A TRUTHY empty placeholder, not null — null fails the staleness
          // guard's `activeMapCache &&` check above, so with no active map
          // spotlighted (a common state) every render would re-trigger a
          // fetch, whose completion called onLoaded (render()) again,
          // triggering another fetch — a tight async loop read as constant
          // flashing that blocked all interaction.
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
  // one pairing shares a refId (map-viewer.js's resolveMarkerLinkedCombatant,
  // inverted). Returns [] — not an error — when there's no active map, no
  // map data yet, or genuinely no marker placed; callers treat an empty
  // result as "nothing to show/toggle."
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
    return linked; // genuinely ambiguous with none linked to THIS combatant — [] rather than guessing
  }

  // Read-only — whether ANY marker representing `combatant` on the active
  // map is currently in that map's auto-managed "Player View" (Orrery's own
  // isElementHiddenFromPlayers, read live instead of a fetched copy). False
  // when there's no linked marker at all, matching a marker's own default.
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
  // writeThroughToCharacter uses (never state's own possibly-stale cached
  // copy — another GM tab, or Orrery itself, could have changed this map).
  // A no-op (status message) when there's no active map or linked marker.
  async function toggleCombatantHiddenFromPlayers(combatant) {
    const map = getCachedActiveMap();
    // !map.id, not !map — getCachedActiveMap() always returns a truthy object, even for "no active map".
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
  // cleared once persist()'s debounced save finishes — see
  // refreshCurrentEncounter's own comment for the race this closes: the
  // same "don't apply a fetch older than a write we already know about"
  // problem map-live-sync.js's watchMapForChanges already solves for maps.
  let pendingEncounterWrite = false;

  const persist = debounce(async () => {
    if (!state.encounter || mode !== "gm") {
      pendingEncounterWrite = false; // markDirty always sets this — clear it even on this early-out
      return;
    }
    try {
      // Library-sourced encounters never embed their own id in the body —
      // strip it from a clone before saving, not state.encounter itself,
      // since every other function here keeps reading state.encounter.id.
      const { id: _id, ...body } = state.encounter;
      await dataManager.save("encounter", state.encounter.id, body);
    } catch (error) {
      status?.show(error.message || "Unable to save the encounter.", { type: "error" });
    } finally {
      pendingEncounterWrite = false;
    }
  }, 600);

  function markDirty() {
    // Flagged HERE, synchronously, not once persist()'s debounced timer
    // fires — a monster/NPC combatant's added condition only lives in
    // state.encounter (no separate write-through), so it was purely at the
    // mercy of this 600ms window: if the "encounter" live-stream event
    // (fires on every save in the group, including this GM's own) landed
    // inside it, refreshCurrentEncounter would refetch the still-stale
    // server copy and overwrite state.encounter, silently discarding the
    // just-typed condition. A Character combatant self-healed via its own
    // writeThroughToCharacter save; a Monster/NPC combatant had nothing to self-heal from.
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
    button.setAttribute("aria-label", label);
    button.setAttribute("data-bs-toggle", "tooltip");
    button.setAttribute("data-bs-title", label);
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
    // an encounter created while offline/anonymous and later synced could otherwise appear twice.
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
      // this file does this; without it a GM's own tracker (including on a
      // fresh reload) kept showing its last-known LOCAL copy whenever a
      // player pushed initiative from their own character sheet, since that
      // write only lands on the server + the player's own local cache.
      const result = await dataManager.get("encounter", id, { shareToken, preferLocal: false });
      state.encounter = result.payload;
      state.encounter.id = id; // the record's own id isn't in the body — stamp it from the fetch id

      const fields = await loadSystemFields(dataManager, state.encounter.systemId);
      state.combatBindings = deriveCombatBindings(fields);
      state.conditions = deriveConditionsVocabulary(fields, state.combatBindings);
      render();
    } catch (error) {
      status?.show("Unable to load that encounter.", { type: "error" });
      // Same self-heal as pollActiveEncounter's own — a dead ?encounter=<id> deep link clears the stale spotlight too.
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
      // otherwise leave every viewer stuck re-fetching a dead id forever —
      // checked against the group's actual active spotlight, not the
      // local-only state.announced flag (which resets on reload).
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

  // Monster, Forge NPC, and character records all resolve through the same
  // combatBindings resource/value paths writeThroughToCharacter uses to
  // write back — a freshly added combatant starts at the source record's
  // own current/max (a fresh monster/NPC's current equals max; a
  // character's current reflects damage already carried). A System with no
  // matching binding, or a record with nothing at that path, falls back to the manual-entry 0/0 default.
  async function addCombatant({ refKind, refId, name }) {
    if (!state.encounter) return;
    let resolvedName = name;
    let stats = { hp: 0, maxHp: 0, tempHp: 0, ac: 0, hpResourceName: "", resources: [] };
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
      // Which named resource `hp`/`maxHp` represent for this System, plus
      // every OTHER `resource`-role binding — read-only mirrors, no edit UI
      // here, but real data Orrery's Marker Resource Bar can read.
      hpResourceName: stats.hpResourceName,
      resources: stats.resources,
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

  // Players roll their own characters' initiative on their sheet, so this
  // only touches non-character combatants: monster/npc combatants (whose
  // linked record supplies a modifier via combatBindings' "modifier"-role
  // entry) and freeform combatants (flat roll with +0). The die comes from
  // that entry's own `die`, defaulting to d20. Best-effort per combatant —
  // a record fetch failure falls back to +0 rather than aborting the whole roll.
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
  // source of truth (unlike a monster/npc's base record, which never
  // changes): a GM edit here writes through via the System's combatBindings
  // paths, so this and Workbench's character sheet read/write one real
  // value instead of two drifting copies. Best-effort — the encounter's own
  // copy stays authoritative regardless of write-through success, so failures are logged, not surfaced.
  async function writeThroughToCharacter(combatant, updates) {
    if (combatant.refKind !== "character" || !combatant.refId) return;
    const bindings = state.combatBindings;
    if (!bindings) return;
    const resource = findBindingByRole(bindings, "resource");
    const value = findBindingByRole(bindings, "value");
    const tags = findBindingByRole(bindings, "tags");
    try {
      // preferLocal: false — a read-modify-write round trip against
      // whatever the character record actually is right now (possibly just
      // changed by the player on their own sheet); a stale local cache would silently clobber that change.
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
      // Not a game-mechanical field a System defines a binding for — a
      // suite-level annotation of which conditions are hidden from map
      // marker badges, always at this fixed key regardless of System.
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
    // Cleanup — a removed tag shouldn't linger in hiddenTags and silently suppress a later, unrelated tag reusing the same text.
    if (Array.isArray(combatant.hiddenTags)) {
      const hiddenIndex = combatant.hiddenTags.indexOf(value);
      if (hiddenIndex !== -1) combatant.hiddenTags.splice(hiddenIndex, 1);
    }
    markDirty();
    void writeThroughToCharacter(combatant, { conditions: combatant.conditions, hiddenTags: combatant.hiddenTags || [] });
  }

  // Visibility ("Show to table") and combat state ("Start/Stop") are fully
  // independent controls with zero automatic coupling — starting combat
  // doesn't show it, stopping doesn't hide it, hiding doesn't stop combat.
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

  // Marks the spotlight `data.hidden` instead of clearing it outright — a
  // fully-cleared encounter stopped being "the active encounter" for ANY
  // purpose, including character-sheet.js's pushInitiativeToActiveEncounter
  // — hiding combat from the table (a deliberate, supported thing to want)
  // broke initiative pushing entirely, not just visibility.
  // updateSpotlightData posts a `spotlight-update` entry, which
  // resolveActiveSpotlightId already treats as equally "active" as the
  // original `spotlight` entry — the encounter stays findable, just flagged
  // not-for-display; player-facing rendering checks the flag and hides accordingly.
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
      // Only flip state on confirmed success — setting this unconditionally
      // used to desync client from server on failure: the toggle turned off
      // immediately, then flipped back on after a refresh, with no obvious explanation why.
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
  // Stop clears both. Deliberately touches nothing about visibility —
  // active/started and visible/shown are two fully independent toggles with
  // zero automatic coupling, so combat can run privately from turn 1, or a
  // hidden encounter can stay shown from an earlier session while re-starting.
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
    // A hidden encounter is still the campaign's ACTIVE encounter —
    // character-sheet.js's initiative push needs to find it regardless of
    // visibility — but a player-mode tracker's rendering must still respect
    // "not shown to the table." Checking the resolved data (not just the id) makes that distinction.
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
      // A confirmed 404 means the spotlighted encounter is gone —
      // deleteEncounter clears the spotlight for its own deletion, but this
      // covers any record gone without that. Clearing it here group-wide
      // stops every viewer's poll from re-hitting the dead id forever —
      // any group member is allowed to post a spotlight-clear log entry.
      if (error?.status === 404 && groupId) {
        dataManager.clearSpotlight({ groupId, shareToken, kind: "encounter", id }).catch(() => {});
      }
    }
  }

  // createReliableInterval, not plain setInterval — a player-mode tracker
  // popped onto a second screen must not stall unfocused (see reliable-interval.js).
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

  // Wakes the existing poll functions up sooner on a relevant change, never
  // a replacement for them — if the stream can't connect or drops, polling
  // keeps working. GM mode has no poll loop of its own except for this: a
  // character-combatant's HP/conditions can change from *outside* the
  // tracker (a player editing their own sheet), so GM mode subscribes too.
  let liveStream = null;

  // Unlike selectEncounter() (a deliberate user action), this is triggered
  // by *someone else's* change landing on the encounter already open, so it
  // swaps in fresh data without disturbing the current selection.
  async function refreshCurrentEncounter() {
    if (!state.encounter) return;
    // Skip entirely while a local edit is still queued/mid-save — this
    // fires on every encounter save in the group, including this GM's own
    // not-yet-persisted one, and would otherwise overwrite state.encounter with a stale pre-edit copy.
    if (pendingEncounterWrite) return;
    const id = state.encounter.id;
    try {
      const result = await dataManager.get("encounter", id, { preferLocal: false });
      if (pendingEncounterWrite) return; // re-checked after the await — a local edit can start while this fetch is in flight
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
        // ITS OWN path resolves to a number — current HP used to only
        // update when max ALSO resolved (nested inside that check), so a
        // System with no maxPath (or one that failed to resolve) silently
        // never reflected a player's current-HP edit either. "Leave alone
        // if unresolvable", not resolveCombatantStats' zero-default (that's
        // for seeding a BRAND NEW combatant) — an existing combatant's known
        // value should never reset to 0 just because one field briefly didn't resolve.
        const current = resolveBinding(resource.binding, payload);
        if (typeof current === "number") combatant.hp = current;
        if (resource.maxPath) {
          const max = resolveBinding(resource.maxPath, payload);
          if (typeof max === "number") combatant.maxHp = max;
        } else if (typeof resource.max === "number") {
          combatant.maxHp = resource.max; // a literal ceiling (e.g. Hope: max 6) isn't stored on the character record
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
      // Every OTHER resource-role binding beyond the primary one — same
      // "leave alone if unresolvable" fallback, matched by name against
      // `combatant.resources` (seeded at addCombatant time) so a resource
      // this System no longer defines just stops updating rather than vanishing.
      const secondaryResources = findBindingsByRole(state.combatBindings, "resource").slice(1);
      if (secondaryResources.length && Array.isArray(combatant.resources)) {
        secondaryResources.forEach((binding) => {
          const existing = combatant.resources.find((entry) => entry.name === binding.name);
          if (!existing || !binding.binding) return;
          const current = resolveBinding(binding.binding, payload);
          if (typeof current === "number") existing.current = current;
          if (binding.maxPath) {
            const max = resolveBinding(binding.maxPath, payload);
            if (typeof max === "number") existing.max = max;
          } else if (typeof binding.max === "number") {
            existing.max = binding.max;
          }
          if (binding.tempPath) {
            const temp = resolveBinding(binding.tempPath, payload);
            if (typeof temp === "number") existing.temp = temp;
          }
        });
      }
      markDirty();
    } catch (error) {
      // Character deleted/inaccessible — leave the combatant's existing
      // mirror alone rather than erroring the whole tracker.
    }
  }

  // Safety-net sweep, not the primary update path — the live-stream
  // subscription above makes an edit feel instant, but a live-stream
  // connection can silently miss an event (a backgrounded/throttled tab, a
  // reconnect backoff climbing to 15s) with nothing else noticing. Every
  // other poller in this suite follows "live-stream wakes it up sooner, a
  // plain poll guarantees it eventually happens regardless" — GM mode's
  // character sync was the one exception. This re-syncs every PC combatant
  // on a fixed cadence, giving character->encounter sync a bounded worst-case latency.
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

  // Forces the next ensureActiveMapCached call to refetch instead of
  // trusting the stale-but-not-yet-expired cache — same "collapse the cache
  // entry and re-render immediately" reasoning Orrery's app.js and the
  // Dashboard's map.js widget apply to their own live-stream subscriptions.
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

  // Separate from Start/Stop — visibility and whether combat is actively
  // running are independent. Lives in the Dashboard card's header
  // (setRightAction — same slot Map/Handout/Game Log use).
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

  // `.text-warning` carries `!important` in Bootstrap, so this stays
  // legible whether or not the row is also selected — a left border, tried
  // first, disappeared once Bootstrap's `.active` selection background took over the same edge.
  function renderTurnBadge() {
    const marker = el("span", "text-warning fw-bold", "▶");
    marker.setAttribute("data-bs-toggle", "tooltip");
    marker.setAttribute("data-bs-title", "Current turn");
    marker.setAttribute("aria-label", "Current turn");
    return marker;
  }

  // Temp HP is a separate buffer on top of current HP (5e-style: absorbed
  // first, doesn't raise the max) — shown as "current(+temp)/max". Enforcing
  // 5e's own stacking rule isn't this tracker's job; it just displays whatever the sheet currently says.
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
  // Edit button; selecting a row IS opening its details. Visible and
  // Delete live in its header, next to the Name field.
  //
  // Built exactly ONCE per selected combatant identity (see refreshEditPanel
  // below) — every input handler resolves selectedCombatant() fresh at
  // event time rather than closing over `combatant` directly, since
  // state.encounter can be wholesale-replaced by a poll/sync refresh
  // between when this panel was built and when the GM commits an edit.
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
    // syncEditPanelValues) — these values just seed the first paint.
    const visibleButton = iconButton(
      isCombatantHiddenFromPlayers(combatant) ? "tabler:eye-off" : "tabler:eye",
      "Visible to players"
    );
    visibleButton.addEventListener("click", toggleSelectedHidden);
    const deleteButton = iconButton("tabler:trash", "Delete combatant", "btn-outline-danger");
    deleteButton.addEventListener("click", deleteSelected);
    nameRow.append(visibleButton, deleteButton);

    // Labels come from the active System's own combatBindings entries (a
    // non-D&D System might call these "Reflexes"/"Stress"/"Defense"),
    // falling back to generic names when a System hasn't configured
    // combat bindings. Initiative tracking always shows regardless.
    const resourceBinding = findBindingByRole(state.combatBindings, "resource");
    const valueBinding = findBindingByRole(state.combatBindings, "value");
    const modifierBinding = findBindingByRole(state.combatBindings, "modifier");

    // Row 2: Initiative + AC together — the "how this turn/hit goes" numbers, separate from HP below.
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

    // Row 3: current/max/temp HP and the ± delta box together, separate
    // from Init/AC above. flex-nowrap + overflow-x-auto, not flex-wrap —
    // four number boxes plus the delta box don't reliably fit one line at
    // every card width; scrolling sideways beats separating HP from the ± box next to it.
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
    // "Remove HP" — a delta box: a positive number subtracts from current
    // HP, negative adds it back (heal). Inverted from a plain "+/- HP" box
    // on purpose — most entries during a real session are damage. Always
    // clears back to blank after applying, and never reflects persisted state.
    const hpDeltaInput = el("input", "form-control form-control-sm");
    hpDeltaInput.type = "number";
    hpDeltaInput.style.width = "4.5rem";
    hpDeltaInput.placeholder = "±HP";
    hpDeltaInput.setAttribute("aria-label", "Remove HP");
    hpDeltaInput.setAttribute("data-bs-toggle", "tooltip");
    hpDeltaInput.setAttribute("data-bs-title", "Remove this much HP — type a negative number to heal instead");
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
    // every sync, since a badge has no value to type into), the Add Tag
    // input+visibility-toggle+Add button on the right — built ONCE here and
    // only ever SYNCED in place afterward. This used to also rebuild every
    // sync, which wiped typing mid-keystroke by an unrelated render. Making
    // this row stable removes the whole bug class rather than chasing it.
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
  // inputs — never recreates a DOM node. Skips whichever input is
  // `document.activeElement`, so an unrelated render can't overwrite an
  // edit mid-typing. hpDeltaInput is excluded — it's a transient action, not persisted state.
  function syncEditPanelValues(refs, combatant) {
    const active = document.activeElement;
    if (active !== refs.nameInput) refs.nameInput.value = combatant.name;
    if (active !== refs.initInput) refs.initInput.value = combatant.initiative;
    if (active !== refs.hpInput) refs.hpInput.value = combatant.hp;
    if (active !== refs.maxHpInput) refs.maxHpInput.value = combatant.maxHp;
    if (active !== refs.tempHpInput) refs.tempHpInput.value = combatant.tempHp ?? 0;
    if (active !== refs.acInput) refs.acInput.value = combatant.ac ?? 0;

    // Resolves whether THIS combatant has a linked marker on the active map, and if so whether it's currently hidden.
    ensureActiveMapCached(() => render());
    const activeMap = getCachedActiveMap();
    // "Hidden from players" is only meaningful once a map is actually shown
    // to players — before that, everything on every map is effectively
    // hidden already. Distinguishing WHY matters: "no map shown to the
    // table" (ordinary prep-time state) reads very differently from "this
    // combatant isn't placed on the map that IS shown" (an actual setup
    // gap) — conflating the two read as "your marker is wrong" when the real reason was "you haven't clicked Show yet."
    const hasActiveMap = Boolean(activeMap?.id);
    const linkedMarkerCount = resolveCombatantMarkers(combatant, activeMap).length;
    const hiddenFromPlayers = isCombatantHiddenFromPlayers(combatant);
    const visibleIcon = refs.visibleButton.querySelector(".iconify");
    if (visibleIcon) visibleIcon.dataset.icon = hiddenFromPlayers ? "tabler:eye-off" : "tabler:eye";
    // Disabled (not hidden) when this combatant has no linked marker on the
    // active map — this button's own row always needs to exist. A real
    // `disabled` attribute blocks hover, so the WHY lives on setDisabledTooltip's own wrapper, not this button.
    const blockedTitle = !hasActiveMap
      ? "No map is shown to the table or open on your dashboard — nothing to show/hide yet"
      : !linkedMarkerCount
        ? "Not placed on the active map — nothing to show/hide"
        : "";
    const readyTitle = hiddenFromPlayers ? "Hidden from players — click to reveal" : "Visible to players — click to hide";
    refs.visibleButton.setAttribute("aria-label", blockedTitle || readyTitle);
    setDisabledTooltip(refs.visibleButton, blockedTitle);
    if (!blockedTitle) initTooltip(refs.visibleButton, { title: readyTitle });

    // Badges have no value a GM types into, so it's safe to rebuild this
    // fresh every sync. The Add Tag input/visibility-toggle/Add button are
    // built ONCE in buildEditPanel and only ever synced in place via
    // applyTagVisibilityState — same pattern visibleButton uses.
    disposeTooltips(refs.badgesMount);
    refs.badgesMount.innerHTML = "";
    refs.badgesMount.appendChild(renderCombatantTagBadges(combatant, { removable: true }));
    applyTagVisibilityState(refs.tagVisibilityButton, pendingTagHidden);

    refreshTooltips(refs.panel);
  }

  // Creates every persistent mount exactly once (a no-op after the first
  // call). Called from renderGm() itself rather than init(), so it's never reached in player mode.
  function ensureGmShell() {
    if (topBarMount) return;
    container.innerHTML = "";
    const root = el("div", "combat-tracker-widget d-flex flex-column gap-2");

    // All direct children of `root`'s gap-2 flex column — gap-2 only
    // applies between children actually in layout, so a hidden (d-none) mount contributes no extra blank space.
    topBarMount = el("div");
    toolbarMount = el("div", "d-flex flex-wrap gap-3 align-items-center justify-content-end d-none");
    emptyStateMount = el("p", "text-body-secondary small mb-0", "Select or create an encounter to start tracking combat.");
    listMount = el("div", "list-group d-none");
    // Not appended to `root` here — relocated dynamically into listMount
    // right after whichever row is selected. Still created once up front so
    // refreshEditPanel always has a stable node to build/sync into.
    editPanelMount = el("div");
    addRowMount = el("div", "d-none"); // starts hidden — only shows once an encounter is selected
    addRowMount.appendChild(renderGmAddCombatantRow());

    root.append(topBarMount, toolbarMount, emptyStateMount, listMount, addRowMount);
    container.appendChild(root);
  }

  // Rebuilds topBarMount's DOM only when what it depends on (owned-
  // encounter list, systems list, current encounter/system) has actually
  // changed since the last render. Cheap to call every render; the
  // signature check keeps it from touching the DOM otherwise.
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
  // inputs, so that's fine reflecting a poll/sync tick live. That stopped
  // being unconditionally true once editPanelMount started living INLINE
  // here instead of as a separate section — it DOES have free-text inputs,
  // and rebuilding via innerHTML="" detaches whatever's currently focused,
  // then re-inserts it moments later, during which the browser reliably
  // fires blur — the same "typing interrupted by an unrelated render" class
  // of bug fixed elsewhere in this file. Skipping the rebuild while focus
  // is inside editPanelMount closes it: refreshEditPanel (called before
  // this in renderGm) already handles syncing/tearing down its CONTENT
  // independent of whether this function touches its POSITION — a
  // deselect/delete moves focus itself before this check runs, so that
  // case still updates immediately; only "still editing the SAME combatant" is deferred.
  function refreshCombatantList() {
    if (editPanelMount.contains(document.activeElement)) return;
    disposeTooltips(listMount);
    listMount.innerHTML = "";
    state.encounter.combatants.forEach((combatant, index) => {
      listMount.appendChild(renderCombatantRow(combatant, index));
      // Inline expansion, right after the row it belongs to. editPanelRefs
      // (not just state.selectedCombatantId) is the source of truth for "is
      // this panel actually built and ready" — refreshEditPanel maintains it.
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
  // changes; otherwise pushes fresh values into the already-built inputs
  // via syncEditPanelValues, which skips whichever input has focus.
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
      pendingTagHidden = false; // a toggle left on shouldn't carry over to a DIFFERENT combatant's Add Tag row
    }
    syncEditPanelValues(editPanelRefs, combatant);
  }

  // Synchronous, and touches only whichever mounts actually need it this render.
  function renderGm() {
    ensureGmShell();
    const hasEncounter = Boolean(state.encounter);

    emptyStateMount.classList.toggle("d-none", hasEncounter);
    toolbarMount.classList.toggle("d-none", !hasEncounter);
    listMount.classList.toggle("d-none", !hasEncounter);
    addRowMount.classList.toggle("d-none", !hasEncounter);

    refreshTopBar();
    if (hasEncounter) {
      // Needed by refreshCombatantList's eye-off row badge and refreshEditPanel's "Visible to players" toggle.
      ensureActiveMapCached(() => render());
      refreshToolbar();
      // refreshEditPanel BEFORE refreshCombatantList, not after: (1) its own
      // teardown on deselect/delete removes whatever was focused BEFORE
      // refreshCombatantList's "skip while focused" guard runs — reversed,
      // that guard would see the just-deleted Delete button as still
      // "focused" and skip updating the list. (2) by the time
      // refreshCombatantList re-inserts editPanelMount, its content is already fresh.
      refreshEditPanel();
      refreshCombatantList();
    } else if (editPanelRefs) {
      disposeTooltips(editPanelMount);
      editPanelMount.innerHTML = "";
      editPanelRefs = null;
    }

    // Was unconditional every renderGm() call, rebuilding the shared
    // <datalist>'s <option> elements out from under the browser while its
    // native suggestion popup was open — that's what made the "Add a tag"
    // autocomplete list keep disappearing mid-use.
    if (state.conditions !== lastConditionsRendered) {
      renderTagDatalist(TAG_DATALIST_ID, state.conditions);
      lastConditionsRendered = state.conditions;
    }
    updateVisibilityAction();
  }

  // A rough, numeric-free read on how hurt a non-PC combatant is — players never see actual HP numbers, just this.
  function describeMonsterCondition(hp, maxHp) {
    if (hp <= 0) return "Unconscious";
    if (maxHp > 0 && hp / maxHp <= 0.5) return "Bleeding";
    if (hp < maxHp) return "Hurt";
    return "";
  }

  // "Character 1"/"NPC 1"/"Monster 1" — reuses REF_KIND_LABELS.
  // `hiddenCombatants` is every currently-hidden combatant, in render
  // order — N is this one's ordinal among others sharing its kind, so two
  // hidden Characters and one hidden Monster read "Character 1"/"Character
  // 2"/"Monster 1", not one counter across kinds. Computed fresh every render, never stored.
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

    ensureActiveMapCached(() => render()); // needed for isCombatantHiddenFromPlayers below
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
          // The deep-linked encounter no longer exists. selectEncounter
          // already surfaced a toast; this stops the dead reference from re-triggering on every future reload.
          const url = new URL(window.location.href);
          url.searchParams.delete("encounter");
          window.history.replaceState(null, "", url);
        }
      } else {
        // Resume whatever's still being shown to the table — without this,
        // a plain page refresh always started with NOTHING selected, even
        // though the server-side spotlight is untouched by reloading.
        const activeId = groupId
          ? await resolveActiveSpotlightId(dataManager, { groupId, shareToken, kind: "encounter" }).catch(() => "")
          : "";
        if (activeId) {
          await selectEncounter(activeId);
          // selectEncounter always resets this to false, since it has no
          // way to know WHY an id was selected — this caller does know, since resolving to this id means it's currently shown.
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
    // No per-instance show/hide toggle (Combat Tracker is multiple: false —
    // only one instance can exist on a dashboard) — always true once
    // mounted. Needed purely so dashboard.js's findActiveWidgetInstance("combat") can find this instance.
    isVisible: () => true,
    // Called by the Map widget when its map owner clicks a linked marker —
    // selects the matching combatant here too, same refKind+refId(+linkedCombatantId) matching as
    // map-viewer.js's resolveMarkerLinkedCombatant. GM mode only; no-op when there's no encounter or no unambiguous match.
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
    // "show to table" spotlight, if announced, needs clearing. Unlike
    // handout.js/map.js/clocks.js (each keyed by a per-instance `visible`
    // flag), this widget never cleared its spotlight on removal at all — a
    // GM removing Combat Tracker while an encounter was shown left it
    // permanently stuck "active" in the group log. `state.announced` is this widget's equivalent of that missing flag.
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
// "encounter" Library record (preferLocal:false — must see whatever's
// actually on the server) rather than reusing `state.encounter`, since
// there may be no live widget mounted at all.

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
// encounter is currently spotlighted to the group, like the player-mode poll above.
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
    let stats = { hp: 0, maxHp: 0, tempHp: 0, ac: 0, hpResourceName: "", resources: [] };
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
      // See addCombatant's own identical comment above.
      hpResourceName: stats.hpResourceName,
      resources: stats.resources,
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
