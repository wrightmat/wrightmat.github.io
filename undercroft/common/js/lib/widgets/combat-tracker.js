// Combat/initiative tracker — the GM half authors an "encounter" Library
// record (readTier: free, writeTier: gm — see
// undercroft/common/data/kind/encounter.json) and the player half polls it
// read-only. Built as a mountable widget (not a page of its own) because
// combat tracking is party/session-scoped, not character-scoped like
// Workbench's view-switcher, and doesn't belong to any one existing tool —
// see the Dashboard plan this widget was built for.
import { resolveActiveSpotlightId, resolveSpotlightData, retirePreviousEncounterSpotlight } from "../spotlight.js";
import { disposeTooltips, refreshTooltips, setDisabledTooltip, initTooltip } from "../tooltips.js";
import { findBindingByRole, findBindingsByRole } from "../bindings.js";
import { resolveDottedPath, setAtDottedPath } from "../dotted-path.js";
import {
  deriveConditionsVocabulary,
  buildSystemConditions,
  renderTagBadges,
  renderTagDatalist,
  buildTagInputRow,
  applyTagVisibilityState,
} from "./tag-editor.js";
import { resolveToolHref, resolveToolContextPath } from "../app-shell.js";
import { connectLiveStream } from "../live.js";
import { el, escapeHtml } from "../dom.js";
import { confirmDelete } from "../ownership.js";
import { loadSystemFields, deriveCombatBindings, resolveCombatantStats } from "./combat-bindings.js";
import { uniquifyCombatantName } from "./combatant-naming.js";
import { fetchGroupMemberCharacters } from "./group-context.js";
import { createReliableInterval } from "../reliable-interval.js";
// The shared dice engine, not rollExpression's overlay/toast wrapper — this
// rolls potentially many non-character combatants' initiative in one
// Promise.all batch, which a single shared 3D overlay canvas isn't
// designed to show all at once, so this stays a plain, silent roll.
import { rollDiceExpression } from "../../../../workbench/js/lib/dice.js";
// Combat Tracker visibility and Map marker visibility are independent
// facts (see this file's own `hidden` field vs. the Map's own
// hiddenElementIds) — these are only for the optional "also hide/show it
// on the map?" cross-link prompt, never to derive one from the other.
import { resolveCombatantMarkers } from "../combat-map-link.js";
import { persistViewVisibility } from "../map-live-sync.js";
import { showConfirmModal } from "../confirm-modal.js";
import { initHelpSystem } from "../help.js";
import { applyWledSegmentScene, fetchWledDevices, resolveWledDeviceByAlias, subscribeWledDeviceEdits } from "./wled.js";
import {
  normalizeLighting,
  tableSegmentNames,
  computeTableScene,
  previewScene,
  createTableLightingPanel,
} from "./combat-table-lighting.js";

// Module-relative so it names the same file the Dashboard's own help system loads.
const HELP_TOPICS_URL = new URL("../../../data/help-topics.json", import.meta.url).href;

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

// state.conditions, icon/color-enhanced — buildSystemConditions derives its
// own combatBindings internally (cheap, pure, `fields` is already in hand at
// every call site) rather than reusing the caller's; that's the same source
// Orrery/the Map widget already use for a marker's own condition icons, so
// Combat Tracker's row/panel now agree with what a linked marker shows.
// Preserves deriveConditionsVocabulary's own `null` (no tags vocabulary at all).
function deriveConditionsWithIcons(fields, combatBindings) {
  const vocabulary = deriveConditionsVocabulary(fields, combatBindings);
  if (!vocabulary) return vocabulary;
  const { iconMap } = buildSystemConditions(fields);
  return vocabulary.map((entry) => ({ ...entry, ...iconMap.get(entry.id) }));
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
    // Per-instance storage (dashboard.js's contentRef slot) — holds the GM's
    // table-lighting settings. Absent in player mode and anywhere without a
    // dashboard to persist into, which just means no lighting panel.
    contentRef,
    setContentRef,
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
  // across whichever combatant is selected; once committed, it's the
  // combatant's own `hiddenTags` array (unrelated to this combatant's own
  // `hidden` field, or to any Map View data).
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

  // "Visible to players" is this combatant's OWN `hidden` field (see
  // addCombatant) — fully independent of any linked map marker's own
  // visibility. This active-map cache exists only so toggleCombatantHidden
  // can offer the optional "also hide/show it on the map?" cross-link
  // prompt when a linked marker actually exists — never to derive the
  // tracker's own visibility from it. Fetch-once-then-stale, same shape as
  // the active encounter cache below — a live-stream subscription to the
  // "map" kind wakes this up sooner.
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

  // Read-only — Combat Tracker's OWN visibility fact for this combatant,
  // nothing to do with any linked map marker (see addCombatant's own comment).
  function isCombatantHidden(combatant) {
    return Boolean(combatant?.hidden);
  }

  // Flips the tracker's own field and saves via the encounter's normal
  // autosave — this ALWAYS happens, independent of the cross-link prompt
  // below. Only if resolveCombatantMarkers finds a linked marker on the
  // active map does this go on to OFFER (never force) also hiding/showing
  // it there too — declining leaves the map untouched.
  async function toggleCombatantHidden(combatant) {
    if (!combatant) return;
    const nextHidden = !combatant.hidden;
    combatant.hidden = nextHidden;
    markDirty();
    const map = getCachedActiveMap();
    const markers = resolveCombatantMarkers(combatant, map);
    if (!markers.length) return; // not on the active map — nothing to offer
    const confirmed = await showConfirmModal({
      title: nextHidden ? "Also hide on the map?" : "Also show on the map?",
      bodyHtml: `<p>"${escapeHtml(combatant.name)}" is also placed on the active map. ${nextHidden ? "Hide" : "Show"} it there too?</p>`,
      confirmLabel: nextHidden ? "Also hide on map" : "Also show on map",
      cancelLabel: "Just the tracker",
    });
    if (!confirmed) return;
    try {
      const freshMap = await persistViewVisibility({
        dataManager,
        mapId: map.id,
        elementIds: markers.map(({ marker }) => marker.id),
        hidden: nextHidden,
      });
      activeMapCache = { id: map.id, payload: freshMap };
      activeMapFetchedAt = Date.now();
      render();
    } catch (error) {
      status?.show(error?.message || "Unable to update the map.", { type: "error" });
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

  // --- GM: table lighting (see combat-table-lighting.js) ------------------
  // Lights the current combatant's segment on a WLED strip around the table.
  // GM mode only — the player view and the second-screen mirror never drive
  // the lights.
  let storedRef = contentRef && typeof contentRef === "object" ? contentRef : {};
  let lighting = normalizeLighting(storedRef.lighting);
  let lightingMount = null;
  let lightingOpen = false;
  let lastLightingPanelSignature = "";
  let lightingMembers = []; // [{id, name}] — the group's party, for seats set before any encounter has them
  const lightingOpenKeys = new Set();
  // The last scene's key — undefined until the first encounter is seen, so
  // loading the page (or the first encounter) never moves the lights; only a
  // change after that does.
  let lastSceneKey;
  // Whether this widget lit something, so ending combat only clears what it
  // set rather than switching off lights it never touched.
  let lightsOwned = false;
  let sceneBusy = false;
  let pendingScene = null;
  let sceneFailureShown = false;

  // One request at a time, and only the latest of a burst — pressing Next
  // quickly shouldn't queue up a stale scene per click. A failure is shown
  // once per streak, not once per turn.
  // The saved lighting devices, re-read at most every 30 s (a scene is pushed on every turn).
  let lightingDevices = { at: 0, list: [] };
  async function lightingDeviceFor(alias) {
    if (Date.now() - lightingDevices.at > 30000 || !resolveWledDeviceByAlias(lightingDevices.list, alias)) {
      lightingDevices = { at: Date.now(), list: await fetchWledDevices(dataManager) };
    }
    const device = resolveWledDeviceByAlias(lightingDevices.list, alias);
    if (!device) throw new Error(`no lighting device aliased "${alias}"`);
    return device;
  }

  async function pushScene(scene, alias = lighting.deviceAlias) {
    if (!alias) return;
    if (sceneBusy) {
      pendingScene = { scene, alias };
      return;
    }
    sceneBusy = true;
    try {
      let next = { scene, alias };
      while (next) {
        pendingScene = null;
        try {
          await applyWledSegmentScene(await lightingDeviceFor(next.alias), next.scene);
          sceneFailureShown = false;
        } catch (error) {
          if (!sceneFailureShown) {
            sceneFailureShown = true;
            status?.show?.(`Table lighting: ${error?.message || "couldn't reach the lighting device."}`, {
              type: "error",
              timeout: 4000,
            });
          }
        }
        next = pendingScene;
      }
    } finally {
      sceneBusy = false;
    }
  }

  function clearTable(config = lighting) {
    lightsOwned = false;
    return pushScene({ lit: [], off: tableSegmentNames(config) }, config.deviceAlias);
  }

  function syncTableLighting() {
    if (mode !== "gm" || !lighting.enabled || !lighting.deviceAlias) return;
    if (lastSceneKey === undefined && !state.encounter) return;
    const scene = computeTableScene(state.encounter, lighting);
    if (lastSceneKey === undefined) {
      lastSceneKey = scene.key;
      return;
    }
    if (scene.key === lastSceneKey) return;
    lastSceneKey = scene.key;
    if (!scene.lit.length && !lightsOwned) return;
    lightsOwned = scene.lit.length > 0;
    void pushScene({ lit: scene.lit, off: scene.off });
  }

  function setLighting(next) {
    const previous = lighting;
    lighting = normalizeLighting(next);
    storedRef = { ...storedRef, lighting };
    setContentRef?.(storedRef);
    // Switching it on mid-combat should light the current turn right away,
    // and moving to another device (or switching off) shouldn't strand lit
    // segments on the old one.
    if (!previous.enabled && lighting.enabled) lastSceneKey = "";
    if (lightsOwned && ((previous.enabled && !lighting.enabled) || previous.deviceAlias !== lighting.deviceAlias)) {
      void clearTable(previous);
    }
    render();
  }

  // Everyone who might need a seat: the group's party, plus any PC already
  // in this encounter that the party list doesn't know (matched by character id).
  function buildLightingRoster() {
    const byId = new Map(lightingMembers.map((member) => [member.id, member.name]));
    (state.encounter?.combatants || []).forEach((combatant) => {
      if ((combatant.isPc || combatant.refKind === "character") && combatant.refId && !byId.has(combatant.refId)) {
        byId.set(combatant.refId, combatant.name);
      }
    });
    return Array.from(byId, ([id, name]) => ({ id, name }));
  }

  // Rebuilt only when what it shows changes — its selects and checkboxes are
  // cheap, but a rebuild closes an open native color picker.
  function refreshLightingPanel() {
    const visible = lightingOpen && typeof setContentRef === "function";
    lightingMount.classList.toggle("d-none", !visible);
    const roster = buildLightingRoster();
    const signature = JSON.stringify([visible, lighting, roster]);
    if (signature === lastLightingPanelSignature) return;
    lastLightingPanelSignature = signature;
    disposeTooltips(lightingMount);
    lightingMount.innerHTML = "";
    if (!visible) return;
    lightingMount.appendChild(
      createTableLightingPanel({
        lighting,
        roster,
        dataManager,
        openKeys: lightingOpenKeys,
        onChange: setLighting,
        onTest: (segmentName) => {
          lightsOwned = true;
          void pushScene(previewScene(lighting, segmentName));
        },
        onClear: () => void clearTable(),
      })
    );
    refreshTooltips(lightingMount);
    void initHelpSystem({ root: lightingMount, topicsUrl: HELP_TOPICS_URL });
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
    // Signed in: a local-cache entry only ever exists as a read-acceleration
    // mirror of something that WAS on the server — DataManager.save() only
    // writes to local storage as the primary copy for an anonymous session
    // (see its own comment). So once we have a FRESH remote listing, a local
    // id absent from it isn't a legitimate local-only record, it's stale —
    // almost always because it was deleted (e.g. via Loom) since it was last
    // cached. Relying on every delete call site to perfectly purge every
    // page's own local cache is fragile (confirmed: it wasn't, prior to this
    // fix) — trusting the fresh remote listing as authoritative here instead
    // means a stale survivor can no longer show up regardless of why the
    // cache didn't get invalidated. Anonymous sessions have no such
    // guarantee — local IS the only copy there, so every local entry still counts.
    const remoteIds = new Set(remote.map((entry) => entry?.id).filter(Boolean));
    const localEntries = dataManager.isAuthenticated() ? local.filter((entry) => remoteIds.has(entry?.id)) : local;
    // Dedupe by id (prefer the remote entry, which carries a real title) —
    // an encounter created while offline/anonymous and later synced could otherwise appear twice.
    const byId = new Map();
    [...localEntries, ...remote].forEach((entry) => {
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
      state.conditions = deriveConditionsWithIcons(fields, state.combatBindings);
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
      // Deleting the group's currently-spotlighted encounter would
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
    state.conditions = deriveConditionsWithIcons(fields, state.combatBindings);
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
    const opening = state.selectedCombatantId !== id;
    state.selectedCombatantId = opening ? id : "";
    render();
    // A row-zone click (focusCombatantField, below) gets this for free —
    // focusing an off-screen input is itself what scrolls it into view.
    // Plain name/row clicks call this instead and focus nothing, so without
    // an explicit scroll a row near the bottom of the widget's own scroll
    // area opened its panel out of sight, below the fold. Not on close —
    // nothing to reveal, and the row that was just clicked is already in view.
    if (opening) editPanelMount.scrollIntoView({ block: "nearest" });
  }

  // A row-zone click (the initiative number, the HP text) — unlike
  // selectCombatant above, never TOGGLES an already-open row closed; it
  // only ever ensures this combatant is open and sends focus straight to
  // one specific field, so clicking a different zone on an already-expanded
  // row just moves focus instead of collapsing it.
  function focusCombatantField(id, fieldKey) {
    if (state.selectedCombatantId !== id) {
      state.selectedCombatantId = id;
      render();
    }
    const input = editPanelRefs?.combatantId === id ? editPanelRefs[fieldKey] : null;
    if (input) {
      input.focus();
      input.select();
    }
  }

  // Enter, in one of the quick-edit inputs below, commits AND closes the
  // panel — a plain blur/tab-away still just commits (see each field's own
  // commit function), matching prior behavior; only Enter is a deliberate "I'm done."
  function collapseDetails() {
    state.selectedCombatantId = "";
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
      // Combat Tracker's OWN "visible to players in the tracker" flag —
      // independent of a linked map marker's own visibility (see
      // isCombatantHidden/toggleCombatantHidden below). Matches
      // journal-encounter.js's own combatant builders, which already set this.
      hidden: false,
    });
    markDirty();
  }

  // Convenience for "everyone's here, let's roll" — adds every current
  // group's party member in one action instead of the GM re-adding each
  // PC by hand through the Add Combatant row below. Skips anyone already in
  // the encounter (matched by character refId), so a second click doesn't
  // duplicate the whole party.
  async function addPartyCombatants() {
    if (!state.encounter || !groupId) return;
    const members = await fetchGroupMemberCharacters(dataManager, groupId);
    if (!members.length) {
      status?.show("This group has no party members yet.", { type: "info", timeout: 3000 });
      return;
    }
    const existingIds = new Set(state.encounter.combatants.filter((c) => c.refKind === "character").map((c) => c.refId));
    const toAdd = members.filter((member) => !existingIds.has(member.id));
    if (!toAdd.length) {
      status?.show("Every party member is already in this encounter.", { type: "info", timeout: 3000 });
      return;
    }
    // Sequential, not Promise.all — addCombatant's own uniquifyCombatantName
    // call reads state.encounter.combatants at call time, so adding one at a
    // time keeps the party's naming/order deterministic (roster order)
    // instead of racing on resolution order.
    for (const member of toAdd) {
      await addCombatant({ refKind: "character", refId: member.id, name: member.name });
    }
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
    void toggleCombatantHidden(combatant);
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
    const modifierPath = modifierEntry?.recordField;
    const sides = Number(String(modifierEntry?.die || "d20").replace(/^d/i, "")) || 20;
    await Promise.all(
      targets.map(async (combatant) => {
        let modifier = 0;
        if (modifierPath && combatant.refKind && combatant.refId) {
          try {
            const result = await dataManager.get(combatant.refKind, combatant.refId, { preferLocal: false });
            const resolved = Number(resolveDottedPath(result.payload || {}, modifierPath));
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
      if (updates.hp !== undefined && resource?.recordField) {
        setAtDottedPath(character, resource.recordField, updates.hp);
        changed = true;
      }
      if (updates.maxHp !== undefined && resource?.maxPath) {
        setAtDottedPath(character, resource.maxPath, updates.maxHp);
        changed = true;
      }
      if (updates.tempHp !== undefined && resource?.tempPath) {
        setAtDottedPath(character, resource.tempPath, updates.tempHp);
        changed = true;
      }
      if (updates.ac !== undefined && value?.recordField) {
        setAtDottedPath(character, value.recordField, updates.ac);
        changed = true;
      }
      if (updates.conditions !== undefined && tags?.recordField) {
        setAtDottedPath(character, tags.recordField, updates.conditions);
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

  function removeAllTags(combatant) {
    if (!combatant.conditions.length) return;
    combatant.conditions = [];
    combatant.hiddenTags = [];
    markDirty();
    void writeThroughToCharacter(combatant, { conditions: combatant.conditions, hiddenTags: combatant.hiddenTags });
  }

  // Visibility ("Show to table") and combat state ("Start/Stop") are fully
  // independent controls with zero automatic coupling — starting combat
  // doesn't show it, stopping doesn't hide it, hiding doesn't stop combat.
  async function showToTable() {
    if (!state.encounter || state.announced) return;
    const active = dataManager.getActiveGroup();
    if (!active?.groupId) {
      status?.show("Pick an active group first (see the group menu in the header).", {
        type: "warning",
        timeout: 3000,
      });
      return;
    }
    try {
      await retirePreviousEncounterSpotlight(dataManager, { groupId: active.groupId, nextEncounterId: state.encounter.id });
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
    // A hidden encounter is still the group's ACTIVE encounter —
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
        state.conditions = deriveConditionsWithIcons(fields, state.combatBindings);
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
      // Tracked instead of unconditionally calling markDirty() below (this
      // runs on every periodic GM-sync tick, every combatant, whether or not
      // anything actually moved) — an unconditional save here meant the
      // encounter got re-saved on a fixed cadence regardless of real
      // changes, needlessly multiplying write traffic and widening the
      // window for a genuine edit elsewhere (a GM's own HP/condition change,
      // still debounced in the SAME shared persist()) to lose a race against
      // a save that had nothing new to say.
      let changed = false;
      if (resource?.recordField) {
        // Each of current/max/temp updates independently based on whether
        // ITS OWN path resolves to a number — current HP used to only
        // update when max ALSO resolved (nested inside that check), so a
        // System with no maxPath (or one that failed to resolve) silently
        // never reflected a player's current-HP edit either. "Leave alone
        // if unresolvable", not resolveCombatantStats' zero-default (that's
        // for seeding a BRAND NEW combatant) — an existing combatant's known
        // value should never reset to 0 just because one field briefly didn't resolve.
        const current = resolveDottedPath(payload, resource.recordField);
        if (typeof current === "number" && current !== combatant.hp) {
          combatant.hp = current;
          changed = true;
        }
        if (resource.maxPath) {
          const max = resolveDottedPath(payload, resource.maxPath);
          if (typeof max === "number" && max !== combatant.maxHp) {
            combatant.maxHp = max;
            changed = true;
          }
        } else if (typeof resource.max === "number" && resource.max !== combatant.maxHp) {
          combatant.maxHp = resource.max; // a literal ceiling (e.g. Hope: max 6) isn't stored on the character record
          changed = true;
        }
        if (resource.tempPath) {
          const temp = resolveDottedPath(payload, resource.tempPath);
          if (typeof temp === "number" && temp !== combatant.tempHp) {
            combatant.tempHp = temp;
            changed = true;
          }
        }
      }
      if (value?.recordField) {
        const resolvedValue = resolveDottedPath(payload, value.recordField);
        if (typeof resolvedValue === "number" && resolvedValue !== combatant.ac) {
          combatant.ac = resolvedValue;
          changed = true;
        }
      }
      if (tags?.recordField) {
        const resolvedTags = resolveDottedPath(payload, tags.recordField);
        if (Array.isArray(resolvedTags)) {
          const current = combatant.conditions || [];
          const same = current.length === resolvedTags.length && current.every((entry, index) => entry === resolvedTags[index]);
          if (!same) {
            combatant.conditions = resolvedTags.slice();
            changed = true;
          }
        }
      }
      // Every OTHER resource-role binding beyond the primary one — same
      // "leave alone if unresolvable" fallback, matched by name against
      // `combatant.resources` (seeded at addCombatant time) so a resource
      // this System no longer defines just stops updating rather than vanishing.
      const secondaryResources = findBindingsByRole(state.combatBindings, "resource").slice(1);
      if (secondaryResources.length && Array.isArray(combatant.resources)) {
        secondaryResources.forEach((binding) => {
          const existing = combatant.resources.find((entry) => entry.name === binding.name);
          if (!existing || !binding.recordField) return;
          const current = resolveDottedPath(payload, binding.recordField);
          if (typeof current === "number" && current !== existing.current) {
            existing.current = current;
            changed = true;
          }
          if (binding.maxPath) {
            const max = resolveDottedPath(payload, binding.maxPath);
            if (typeof max === "number" && max !== existing.max) {
              existing.max = max;
              changed = true;
            }
          } else if (typeof binding.max === "number" && binding.max !== existing.max) {
            existing.max = binding.max;
            changed = true;
          }
          if (binding.tempPath) {
            const temp = resolveDottedPath(payload, binding.tempPath);
            if (typeof temp === "number" && temp !== existing.temp) {
              existing.temp = temp;
              changed = true;
            }
          }
        });
      }
      if (changed) markDirty();
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
  function renderCombatantTagBadges(combatant, { removable, compact = false }) {
    return renderTagBadges(combatant.conditions, state.conditions, {
      removable,
      compact,
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
    // Sorted right after — a GM rolling initiative always wants the list in
    // that order immediately, not as a separate manual step.
    rollInitiativeButton.addEventListener("click", () => {
      void rollInitiativeForNonCharacters().then(sortByInitiative);
    });
    // Bulk alternative to the Add Combatant row below — the whole party in
    // one click instead of typing each PC in turn.
    const addPartyButton = iconButton("tabler:users-plus", "Add the party (PCs)");
    addPartyButton.addEventListener("click", () => void addPartyCombatants());
    const deleteButton = iconButton("tabler:trash", "Delete encounter", "btn-outline-danger");
    deleteButton.addEventListener("click", deleteEncounter);
    toolbar.append(startStopButton, prevButton, nextButton, sortButton, rollInitiativeButton, addPartyButton);
    // Pressed while its panel is open; the lit-bulb variant while the feature
    // is on, so it reads as active even with the panel closed. Needs
    // somewhere to save settings, so it's only offered on a dashboard.
    if (typeof setContentRef === "function") {
      const lightingButton = iconButton(
        lighting.enabled ? "tabler:bulb-filled" : "tabler:bulb",
        "Table lighting",
        lightingOpen ? "btn-primary" : "btn-outline-secondary"
      );
      lightingButton.addEventListener("click", () => {
        lightingOpen = !lightingOpen;
        render();
      });
      toolbar.appendChild(lightingButton);
    }
    toolbar.appendChild(deleteButton);
    return toolbar;
  }

  // The lighting device's alias was renamed in the Lighting widget: follow it, without treating it as a
  // switch to another device (which would try to clear the table on a device that no longer answers to the old name).
  const unsubscribeDeviceEdits = subscribeWledDeviceEdits(({ from, to }) => {
    if (mode !== "gm" || !from || !to || String(lighting.deviceAlias).trim().toLowerCase() !== String(from).trim().toLowerCase()) return;
    lighting = { ...lighting, deviceAlias: to };
    lightingDevices = { at: 0, list: [] };
    storedRef = { ...storedRef, lighting };
    setContentRef?.(storedRef);
    render();
  });

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
    // Its own click zone — jumps straight to Initiative instead of just
    // toggling the row, so a quick "type a number, hit Enter" turn update
    // never needs a separate click to find the field first.
    const initiativeSpan = el("span", "fw-semibold", String(combatant.initiative));
    initiativeSpan.style.cursor = "pointer";
    initiativeSpan.addEventListener("click", (event) => {
      event.stopPropagation();
      focusCombatantField(combatant.id, "initInput");
    });
    left.appendChild(initiativeSpan);
    left.appendChild(el("span", null, combatant.name));
    if (isCombatantHidden(combatant)) left.appendChild(icon("tabler:eye-off"));

    const right = el("span", "d-flex align-items-center gap-2");
    // Same zone-click idea as Initiative above — focuses the ±HP delta box
    // (the "how much damage/healing just happened" field), not the raw
    // total, matching how HP actually gets updated turn to turn.
    const hpSpan = el("span", "text-body-secondary small", formatHpText(combatant));
    hpSpan.style.cursor = "pointer";
    hpSpan.addEventListener("click", (event) => {
      event.stopPropagation();
      focusCombatantField(combatant.id, "hpDeltaInput");
    });
    right.appendChild(hpSpan);
    // Same zone-click idea again — focuses the AC input.
    const acBadge = renderAcBadge(combatant);
    acBadge.style.cursor = "pointer";
    acBadge.addEventListener("click", (event) => {
      event.stopPropagation();
      focusCombatantField(combatant.id, "acInput");
    });
    right.appendChild(acBadge);
    // And once more for the tag/condition icons — focuses the "Add a tag"
    // input, since that's what a click here is almost always reaching for.
    const tagBadges = renderCombatantTagBadges(combatant, { removable: false, compact: true });
    tagBadges.style.cursor = "pointer";
    tagBadges.addEventListener("click", (event) => {
      event.stopPropagation();
      focusCombatantField(combatant.id, "tagInput");
    });
    right.appendChild(tagBadges);

    row.append(left, right);
    return row;
  }

  // Applies/removes ONE HP-threshold-derived condition for a single
  // reserved-key combatBinding role — same reserved-key convention as the
  // existing resource/value/tags/modifier roles (see combat-bindings.js's
  // own header comment), no hardcoded condition names or thresholds here.
  // `isActive` is the caller's own threshold check (syncHpConditions,
  // below); `replaceAll` (only `defeated` uses it) replaces every OTHER
  // condition instead of adding alongside them, since an active condition
  // like Poisoned or Charmed is narratively moot once unconscious. Only
  // touches the condition list on an actual crossing (`has` guards both
  // directions) so re-editing HP while already past/short of a threshold
  // never wipes a condition a GM added by hand afterward. A System with no
  // binding configured for this role, or whose declared conditionId doesn't
  // actually exist in state.conditions, is a no-op — graceful, same "never
  // guess" rule the rest of this file's System-driven lookups already follow.
  function syncThresholdCondition(combatant, role, isActive, { replaceAll = false } = {}) {
    const binding = findBindingByRole(state.combatBindings, role);
    const conditionId = binding?.conditionId;
    const valid = conditionId && (state.conditions || []).some((entry) => entry.id === conditionId);
    if (!valid) return;
    const has = (combatant.conditions || []).includes(conditionId);
    if (isActive && !has) {
      combatant.conditions = replaceAll ? [conditionId] : [...(combatant.conditions || []), conditionId];
      if (replaceAll) combatant.hiddenTags = [];
    } else if (!isActive && has) {
      combatant.conditions = combatant.conditions.filter((entry) => entry !== conditionId);
    }
  }

  // HP never goes negative — clamps to 0. Also keeps this System's own
  // HP-threshold conditions (defeated/bloodied/hurt) in sync with HP
  // crossing their threshold, in EITHER direction. The three bands are
  // mutually exclusive by construction — hp<=0, 0<hp<=half, half<hp<maxHp —
  // so a combatant is ever only ONE of the three, never two at once, same
  // as the player-view text descriptor these tags replaced used to cascade
  // through the identical three bands (see describeMonsterCondition).
  // `defeated` runs first since it's the one that replaces everything else;
  // bloodied/hurt's own hp>0 checks already exclude hp<=0, so neither ever
  // re-adds itself against a list `defeated` just wiped.

  function syncHpConditions(combatant) {
    if (combatant.hp < 0) combatant.hp = 0;
    const half = combatant.maxHp > 0 ? combatant.maxHp / 2 : 0;
    syncThresholdCondition(combatant, "defeated", combatant.hp <= 0, { replaceAll: true });
    syncThresholdCondition(combatant, "bloodied", combatant.hp > 0 && combatant.maxHp > 0 && combatant.hp <= half);
    syncThresholdCondition(
      combatant,
      "hurt",
      combatant.hp > 0 && combatant.maxHp > 0 && combatant.hp > half && combatant.hp < combatant.maxHp
    );
  }

  // Enter, in one of buildEditPanel's own quick-edit inputs, commits AND
  // collapses the panel; any other way of leaving the field (blur, tab-away)
  // still just commits, same as before this existed — see collapseDetails'
  // own comment for why only Enter gets the extra step.
  function wireCommitOnEnter(input, commit) {
    input.addEventListener("change", commit);
    input.addEventListener("keydown", (event) => {
      if (event.key !== "Enter") return;
      event.preventDefault();
      commit();
      collapseDetails();
    });
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
      isCombatantHidden(combatant) ? "tabler:eye-off" : "tabler:eye",
      "Visible to players"
    );
    visibleButton.addEventListener("click", toggleSelectedHidden);
    nameRow.appendChild(visibleButton);
    // Monster-only — Crucible already fully supports a `?monster=<id>` deep
    // link (its own applyDeepLinkParams), so this needs no new plumbing:
    // just open it. NPCs/Characters have no equivalent "full stat block"
    // tool to send them to.
    if (combatant.refKind === "monster" && combatant.refId) {
      const statsButton = iconButton("tabler:file-text", "View full stats in Crucible");
      statsButton.addEventListener("click", () => {
        const url = `${resolveToolHref("crucible", resolveToolContextPath())}?monster=${encodeURIComponent(combatant.refId)}`;
        window.open(url, "_blank", "noopener");
      });
      nameRow.appendChild(statsButton);
    }
    const deleteButton = iconButton("tabler:trash", "Delete combatant", "btn-outline-danger");
    deleteButton.addEventListener("click", deleteSelected);
    nameRow.appendChild(deleteButton);

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
    wireCommitOnEnter(initInput, () => {
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
    wireCommitOnEnter(acInput, () => {
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
    wireCommitOnEnter(hpInput, () => {
      const current = selectedCombatant();
      if (!current) return;
      current.hp = Number(hpInput.value) || 0;
      syncHpConditions(current);
      markDirty();
      void writeThroughToCharacter(current, { hp: current.hp, conditions: current.conditions, hiddenTags: current.hiddenTags });
    });
    const maxHpInput = el("input", "form-control form-control-sm");
    maxHpInput.type = "number";
    maxHpInput.style.width = "3.5rem";
    maxHpInput.value = combatant.maxHp;
    wireCommitOnEnter(maxHpInput, () => {
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
    wireCommitOnEnter(tempHpInput, () => {
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
    wireCommitOnEnter(hpDeltaInput, () => {
      const amount = Number(hpDeltaInput.value);
      hpDeltaInput.value = "";
      if (!amount) return;
      const current = selectedCombatant();
      if (!current) return;
      current.hp -= amount;
      syncHpConditions(current);
      markDirty();
      void writeThroughToCharacter(current, { hp: current.hp, conditions: current.conditions, hiddenTags: current.hiddenTags });
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
    // d-flex/align-items-center/gap-1 — a conditional "remove all" button
    // (syncEditPanelValues, only when there's more than one condition) sits
    // as this mount's own first child, inline with the badge-wrapper div
    // renderCombatantTagBadges returns right after it; that wrapper's own
    // internal flex-wrap still handles individual pills wrapping onto a new line.
    const badgesMount = el("div", "flex-grow-1 d-flex align-items-center flex-wrap gap-1");
    const { row: addTagRow, input: tagInput, visibilityButton: tagVisibilityButton } = buildTagInputRow(TAG_DATALIST_ID, {
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
      hpDeltaInput,
      acInput,
      visibleButton,
      badgesMount,
      tagInput,
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

    // This button always has something to toggle now (the tracker's own
    // `hidden` field) — never disabled. Resolving the active map here is
    // only to word the tooltip: whether toggling will also OFFER to sync a
    // linked map marker (see toggleCombatantHidden's own cross-link prompt).
    ensureActiveMapCached(() => render());
    const activeMap = getCachedActiveMap();
    const hasLinkedMarker = resolveCombatantMarkers(combatant, activeMap).length > 0;
    const hiddenInTracker = isCombatantHidden(combatant);
    const visibleIcon = refs.visibleButton.querySelector(".iconify");
    if (visibleIcon) visibleIcon.dataset.icon = hiddenInTracker ? "tabler:eye-off" : "tabler:eye";
    const readyTitle = hiddenInTracker
      ? `Hidden from players in the tracker — click to reveal${hasLinkedMarker ? " (also offers to update the map)" : ""}`
      : `Visible to players in the tracker — click to hide${hasLinkedMarker ? " (also offers to update the map)" : ""}`;
    refs.visibleButton.setAttribute("aria-label", readyTitle);
    setDisabledTooltip(refs.visibleButton, "");
    initTooltip(refs.visibleButton, { title: readyTitle });

    // Badges have no value a GM types into, so it's safe to rebuild this
    // fresh every sync. The Add Tag input/visibility-toggle/Add button are
    // built ONCE in buildEditPanel and only ever synced in place via
    // applyTagVisibilityState — same pattern visibleButton uses.
    disposeTooltips(refs.badgesMount);
    refs.badgesMount.innerHTML = "";
    // Only worth offering once there's more than one — removing a single
    // condition already has its own per-badge remove button right there.
    if ((combatant.conditions || []).length > 1) {
      const removeAllButton = iconButton("tabler:x", "Remove all conditions", "btn-outline-danger");
      removeAllButton.addEventListener("click", () => removeAllTags(combatant));
      refs.badgesMount.appendChild(removeAllButton);
    }
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
    // sticky-top + bg-body — stays reachable at the top of the widget's own
    // scroll area (turn control shouldn't need scrolling back up to use)
    // while topBarMount (the encounter/system picker) scrolls away with the
    // rest, same as any other content. bg-body is required, not cosmetic —
    // without an opaque background the list's own rows show through/behind
    // it while scrolling underneath.
    toolbarMount = el("div", "d-flex flex-wrap gap-3 align-items-center justify-content-end d-none sticky-top bg-body py-1");
    // The table-lighting settings panel — see refreshLightingPanel.
    lightingMount = el("div", "d-none");
    emptyStateMount =el("p", "text-body-secondary small mb-0", "Select or create an encounter to start tracking combat.");
    listMount = el("div", "list-group d-none");
    // Not appended to `root` here — relocated dynamically into listMount
    // right after whichever row is selected. Still created once up front so
    // refreshEditPanel always has a stable node to build/sync into.
    editPanelMount = el("div");
    addRowMount = el("div", "d-none"); // starts hidden — only shows once an encounter is selected
    addRowMount.appendChild(renderGmAddCombatantRow());

    root.append(topBarMount, toolbarMount, lightingMount, emptyStateMount, listMount, addRowMount);
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
    const signature = JSON.stringify({
      started: state.encounter?.started,
      round: state.encounter?.round,
      lightingOpen,
      lightingEnabled: lighting.enabled,
    });
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

  // Rebuilt in full on every render — combatant ROWS have no free-text
  // inputs, so that's always fine reflecting a poll/sync tick or an edit
  // live. editPanelMount DOES have free-text inputs, so it's never itself
  // the node passed to appendChild/insertBefore while it might hold focus —
  // confirmed (not just suspected) that Chrome blurs a focused descendant
  // any time its own node is moved via appendChild/insertBefore, even
  // reordering within the SAME parent, not only when crossing into a
  // different one — an earlier fix here that relocated editPanelMount out to
  // `container` and back on every refresh was still tripping this, since
  // that relocation IS such a move; a periodic background refresh (GM
  // character sync / a live-stream echo of the GM's own save, both on the
  // order of a few seconds) reliably clipped focus a moment after a click
  // zone set it. Instead, only ROW nodes (freshly created, never yet
  // attached — inserting a parentless node is not a move and never blurs
  // anything) are torn down and rebuilt; editPanelMount is used purely as an
  // insertBefore REFERENCE point to thread rows in on either side of it
  // without ever being the moved node itself. It only genuinely moves when
  // newly selected or deselected this render, when nothing inside it is
  // focused yet (focusCombatantField focuses its field only after render()
  // returns) or nothing inside it is focused anymore (refreshEditPanel
  // already emptied it on deselect, right before this runs).
  function refreshCombatantList() {
    disposeTooltips(listMount);
    const selectedId = editPanelRefs?.combatantId || "";
    const editPanelHere = editPanelMount.parentElement === listMount;

    Array.from(listMount.children).forEach((child) => {
      if (child !== editPanelMount) child.remove();
    });

    let reachedSelected = false;
    state.encounter.combatants.forEach((combatant, index) => {
      const row = renderCombatantRow(combatant, index);
      if (editPanelHere && !reachedSelected) {
        listMount.insertBefore(row, editPanelMount);
      } else {
        listMount.appendChild(row);
      }
      if (combatant.id === selectedId) reachedSelected = true;
    });

    if (!state.encounter.combatants.length) {
      listMount.appendChild(el("p", "text-body-secondary small mb-0", "No combatants yet."));
    }

    if (selectedId && !editPanelHere) {
      const rows = Array.from(listMount.children);
      const targetIndex = state.encounter.combatants.findIndex((entry) => entry.id === selectedId);
      listMount.insertBefore(editPanelMount, rows[targetIndex + 1] || null);
    } else if (!selectedId && editPanelHere) {
      listMount.removeChild(editPanelMount);
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
    // autocomplete list keep disappearing mid-use. A combatant essentially
    // never carries the same condition twice, so whichever ones it already
    // has are excluded from its own suggestions — signature covers both the
    // vocabulary itself AND the selected combatant's current conditions, so
    // adding/removing a tag refreshes the exclusion without rebuilding on
    // every unrelated render tick.
    const selectedForDatalist = selectedCombatant();
    const datalistSignature = JSON.stringify({
      vocabulary: (state.conditions || []).map((entry) => entry.id),
      excluded: selectedForDatalist?.conditions || [],
    });
    if (datalistSignature !== lastConditionsRendered) {
      const excludedIds = new Set(selectedForDatalist?.conditions || []);
      const suggestable = (state.conditions || []).filter((entry) => !excludedIds.has(entry.id));
      renderTagDatalist(TAG_DATALIST_ID, suggestable);
      lastConditionsRendered = datalistSignature;
    }
    refreshLightingPanel();
    updateVisibilityAction();
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
      el("span", null, isCombatantHidden(combatant) ? anonymizedCombatantLabel(combatant, hiddenCombatants) : combatant.name)
    );
    const right = el("span", "d-flex align-items-center gap-2");
    // Non-PC combatants never show real HP numbers to players — the
    // defeated/bloodied/hurt condition tags below (once a System configures
    // those bindings) are the numeric-free substitute; see syncHpConditions.
    if (combatant.isPc) {
      right.appendChild(el("span", "text-body-secondary small", formatHpText(combatant)));
    }
    right.appendChild(renderCombatantTagBadges(combatant, { removable: false, compact: true }));
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

    const list = el("div", "list-group");
    const hiddenCombatants = state.encounter.combatants.filter((c) => isCombatantHidden(c));
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
      syncTableLighting();
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
      // The party, for seats set before any encounter has them — best-effort,
      // the panel still lists every PC already in the encounter without it.
      if (groupId && typeof setContentRef === "function") {
        void fetchGroupMemberCharacters(dataManager, groupId).then((members) => {
          lightingMembers = members;
          render();
        });
      }
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
      unsubscribeDeviceEdits();
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
    if (!groupId) throw new Error("No active group to show/hide this to.");
    if (actionName === "show") {
      await retirePreviousEncounterSpotlight(dataManager, { groupId, nextEncounterId: encounterId });
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
      const modifierPath = modifierEntry?.recordField;
      const sides = Number(String(modifierEntry?.die || "d20").replace(/^d/i, "")) || 20;
      await Promise.all(
        targets.map(async (combatant) => {
          let modifier = 0;
          if (modifierPath && combatant.refKind && combatant.refId) {
            try {
              const result = await dataManager.get(combatant.refKind, combatant.refId, { preferLocal: false });
              const resolved = Number(resolveDottedPath(result.payload || {}, modifierPath));
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
