// Combat/initiative tracker — the GM half authors an "encounter" Library
// record (readTier: free, writeTier: gm — see
// undercroft/common/data/kind/encounter.json) and the player half polls it
// read-only. Built as a mountable widget (not a page of its own) because
// combat tracking is party/session-scoped, not character-scoped like
// Workbench's view-switcher, and doesn't belong to any one existing tool —
// see the Dashboard plan this widget was built for.
import { openSpotlightModal } from "../spotlight.js";
import { disposeTooltips, refreshTooltips } from "../tooltips.js";
import { resolveBinding, setAtBinding, findRoleBoundField } from "../bindings.js";
import { connectLiveStream } from "../live.js";
import { el } from "../dom.js";
import { confirmDelete } from "../ownership.js";

const POLL_INTERVAL_MS = 15000;

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

// The tag vocabulary field (default key "conditions", but see
// deriveConditionsPropertyType) and the combat-bindings field (whichever
// array field's values carry a `role` — see findRoleBoundField) both live on
// the same System record's `fields` — one fetch serves both instead of each
// maintaining its own independent round trip. Absent field(s) = no tag
// suggestions / no write-through, gracefully, not an error.
async function loadSystemFields(dataManager, systemId) {
  if (!systemId) return null;
  try {
    // preferLocal: false — a Loom edit to the System's fields (adding/
    // changing conditions or role-bound values) must be visible immediately,
    // not hidden behind whatever copy of this System this browser happened
    // to cache locally on a previous visit. Same reasoning as
    // writeThroughToCharacter's character fetch below.
    const result = await dataManager.get("system", systemId, { preferLocal: false });
    return Array.isArray(result?.payload?.fields) ? result.payload.fields : [];
  } catch (error) {
    return null;
  }
}

// Combat Bindings isn't a field type of its own, or even a flagged field —
// it's just whichever ordinary Enum-mode array field's values happen to use
// Role (see findRoleBoundField in common/js/lib/bindings.js), a generic
// structural vocabulary: "resource" (a number with a ceiling, optionally a
// temp buffer — HP is one instance, not the concept), "value" (one
// standalone number — AC is one instance), "tags" (a multi-select status
// list — Conditions is one instance), "modifier" (a number feeding a roll —
// Initiative is one instance).
function deriveCombatBindings(fields) {
  if (!fields) return null;
  const field = findRoleBoundField(fields);
  return field && Array.isArray(field.values) ? field.values : null;
}

function findBindingByRole(bindings, role) {
  return (bindings || []).find((entry) => entry && entry.role === role) || null;
}

// The tags-role binding's own `sourceField` names which other array field on
// this System supplies the tag vocabulary (e.g. "conditions") — a generic
// "where do the valid options come from" pointer (see loom/js/app.js's
// VALUE_COLUMNS), not specific to combat bindings. Defaulting to
// "conditions" when absent keeps existing Systems working without requiring
// them to set it explicitly.
function deriveConditionsPropertyType(fields, bindings) {
  if (!fields) return null;
  const tagsEntry = findBindingByRole(bindings, "tags");
  const vocabularyKey = tagsEntry?.sourceField || "conditions";
  const field = fields.find((entry) => entry.type === "array" && entry.key === vocabularyKey);
  if (!field) return null;
  return (field.values || []).map((value, index) => ({
    id: value.id || value.name || `condition-${index}`,
    label: value.name || value.label || String(value.id || index),
  }));
}

const REF_KIND_LABELS = { character: "Character", npc: "NPC", monster: "Monster" };
const TAG_DATALIST_ID = "combat-tracker-tag-suggestions";

export function initCombatTrackerWidget(
  container,
  { dataManager, status, mode = "gm", groupId = "", shareToken = "", encounterId = "" } = {}
) {
  if (!container || !dataManager) {
    return { destroy() {} };
  }

  const state = {
    encounter: null,
    conditions: null,
    combatBindings: null,
    ownedEncounters: [],
    pollTimer: 0,
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

  const persist = debounce(async () => {
    if (!state.encounter || mode !== "gm") return;
    try {
      await dataManager.save("encounter", state.encounter.id, state.encounter);
    } catch (error) {
      status?.show(error.message || "Unable to save the encounter.", { type: "error" });
    }
  }, 600);

  function markDirty() {
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
      const result = await dataManager.get("encounter", id, { shareToken });
      state.encounter = result.payload;
      const fields = await loadSystemFields(dataManager, state.encounter.systemId);
      state.combatBindings = deriveCombatBindings(fields);
      state.conditions = deriveConditionsPropertyType(fields, state.combatBindings);
      render();
    } catch (error) {
      status?.show("Unable to load that encounter.", { type: "error" });
    }
  }

  async function createEncounter() {
    const name = window.prompt("Name this encounter:", "New Encounter");
    if (name === null) return;
    const encounter = blankEncounter(name.trim() || "New Encounter");
    try {
      await dataManager.save("encounter", encounter.id, encounter);
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
    try {
      await dataManager.delete("encounter", state.encounter.id);
      state.encounter = null;
      await loadOwnedEncounters();
      render();
    } catch (error) {
      status?.show(error.message || "Unable to delete the encounter.", { type: "error" });
    }
  }

  async function changeSystem(systemId) {
    if (!state.encounter) return;
    state.encounter.systemId = systemId;
    const fields = await loadSystemFields(dataManager, systemId);
    state.combatBindings = deriveCombatBindings(fields);
    state.conditions = deriveConditionsPropertyType(fields, state.combatBindings);
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
    let hp = 0;
    let maxHp = 0;
    let tempHp = 0;
    let ac = 0;
    if (refKind && refId) {
      try {
        const result = await dataManager.get(refKind, refId, { preferLocal: false });
        const payload = result.payload || {};
        if (!resolvedName) resolvedName = payload.name || payload.title || refId;
        const resource = findBindingByRole(state.combatBindings, "resource");
        const value = findBindingByRole(state.combatBindings, "value");
        if (resource?.binding) {
          const current = resolveBinding(resource.binding, payload);
          const max = resource.maxPath ? resolveBinding(resource.maxPath, payload) : undefined;
          if (typeof max === "number") {
            maxHp = max;
            hp = typeof current === "number" ? current : maxHp;
          } else if (typeof current === "number") {
            hp = current;
            maxHp = current;
          }
          if (resource.tempPath) {
            const temp = resolveBinding(resource.tempPath, payload);
            if (typeof temp === "number") tempHp = temp;
          }
        }
        if (value?.binding) {
          const resolvedValue = resolveBinding(value.binding, payload);
          if (typeof resolvedValue === "number") ac = resolvedValue;
        }
      } catch (error) {
        resolvedName = resolvedName || refId;
      }
    }
    state.encounter.combatants.push({
      id: randomId(),
      name: resolvedName || "Combatant",
      refKind: refKind || null,
      refId: refId || null,
      initiative: 0,
      hp,
      maxHp,
      tempHp,
      ac,
      conditions: [],
      isPc: refKind === "character",
      hidden: false,
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
    combatant.hidden = !combatant.hidden;
    markDirty();
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

  function rollDie(sides = 20) {
    return Math.floor(Math.random() * sides) + 1;
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
        combatant.initiative = rollDie(sides) + modifier;
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
      if (changed) {
        await dataManager.save("character", combatant.refId, character);
      }
    } catch (error) {
      console.warn("Combat tracker: unable to write through to character", combatant.refId, error);
    }
  }

  function addTag(combatant, rawValue) {
    const value = String(rawValue || "").trim();
    if (!value || combatant.conditions.includes(value)) return;
    combatant.conditions.push(value);
    markDirty();
    void writeThroughToCharacter(combatant, { conditions: combatant.conditions });
  }

  function removeTag(combatant, value) {
    const index = combatant.conditions.indexOf(value);
    if (index === -1) return;
    combatant.conditions.splice(index, 1);
    markDirty();
    void writeThroughToCharacter(combatant, { conditions: combatant.conditions });
  }

  // Visibility ("Show to table") and combat state ("Start/Stop") are
  // deliberately independent controls — starting combat defaults to also
  // showing it (same "visible by default" convention as a new combatant's
  // own `hidden: false`), but stopping combat doesn't hide it, and hiding
  // doesn't stop combat. Each can be changed on its own afterward.
  async function showToTable() {
    if (!state.encounter || state.announced) return;
    const posted = await openSpotlightModal({
      dataManager,
      status,
      kind: "encounter",
      id: state.encounter.id,
      label: state.encounter.name,
    });
    if (posted) {
      state.announced = true;
      render();
    }
  }

  async function hideFromTable() {
    if (!state.encounter || !state.announced) return;
    const active = dataManager.getActiveGroup();
    if (active?.groupId) {
      try {
        await dataManager.clearSpotlight({ groupId: active.groupId });
        status?.show("Stopped showing to the table.", { type: "success", timeout: 2000 });
      } catch (error) {
        status?.show(error.message || "Unable to stop showing.", { type: "error" });
      }
    }
    state.announced = false;
    render();
  }

  async function toggleVisibility() {
    if (state.announced) {
      await hideFromTable();
    } else {
      await showToTable();
    }
  }

  // The *automatic* show-on-start below is deliberately silent (no
  // confirm modal) — same "just is visible, no prompt" convention as a new
  // combatant's own `hidden: false` default. showToTable()'s confirm
  // dialog stays reserved for the manual eye-button click.
  async function autoShowOnStart() {
    if (!state.encounter || state.announced) return;
    const active = dataManager.getActiveGroup();
    if (!active?.groupId) return;
    try {
      await dataManager.spotlightToGroup({
        groupId: active.groupId,
        contentType: "encounter",
        contentId: state.encounter.id,
      });
      state.announced = true;
      render();
    } catch (error) {
      status?.show(error.message || "Unable to show the encounter to the table.", { type: "error" });
    }
  }

  // Start places the turn indicator on the first combatant at round 1;
  // Stop clears both (no turn indicator, no Round display) without
  // touching visibility, so a GM can reset/restart combat mid-session
  // without re-triggering (or losing) the table's view of the encounter.
  async function startCombat() {
    if (!state.encounter) return;
    state.encounter.started = true;
    state.encounter.round = 1;
    state.encounter.activeIndex = 0;
    markDirty();
    await autoShowOnStart();
  }

  function stopCombat() {
    if (!state.encounter) return;
    state.encounter.started = false;
    markDirty();
  }

  // --- Player: read-only polling -----------------------------------------

  async function resolveActiveEncounterId() {
    if (encounterId) return encounterId;
    try {
      const log = await dataManager.getGroupLog({ groupId, shareToken, limit: 25 });
      const entries = Array.isArray(log?.entries) ? log.entries : [];
      // The server returns entries oldest-first — sort newest-first before
      // picking "the latest spotlight or clear," so a `spotlight-clear`
      // posted after the last `spotlight` correctly wins.
      entries.sort((a, b) => (Date.parse(b.created_at) || 0) - (Date.parse(a.created_at) || 0));
      const latest = entries.find((entry) => entry?.type === "spotlight" || entry?.type === "spotlight-clear");
      if (!latest || latest.type === "spotlight-clear" || latest.payload?.kind !== "encounter") {
        return "";
      }
      return latest.payload?.id || "";
    } catch (error) {
      return "";
    }
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
      if (!state.conditions || state.conditions.__systemId !== state.encounter.systemId) {
        const fields = await loadSystemFields(dataManager, state.encounter.systemId);
        state.combatBindings = deriveCombatBindings(fields);
        state.conditions = deriveConditionsPropertyType(fields, state.combatBindings);
        if (state.conditions) state.conditions.__systemId = state.encounter.systemId;
      }
      render();
    } catch (error) {
      // Not shared with this viewer (yet), or deleted — just show nothing.
      state.encounter = null;
      render();
    }
  }

  function startPolling() {
    stopPolling();
    state.pollTimer = window.setInterval(() => {
      void pollActiveEncounter();
    }, POLL_INTERVAL_MS);
  }

  function stopPolling() {
    if (state.pollTimer) {
      window.clearInterval(state.pollTimer);
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
    try {
      const result = await dataManager.get("encounter", state.encounter.id, { preferLocal: false });
      state.encounter = result.payload;
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
        const max = resource.maxPath ? resolveBinding(resource.maxPath, payload) : undefined;
        if (typeof max === "number") {
          combatant.maxHp = max;
          const current = resolveBinding(resource.binding, payload);
          combatant.hp = typeof current === "number" ? current : combatant.maxHp;
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

  function startLiveStream() {
    liveStream?.close();
    if (!groupId) return;
    if (mode === "gm") {
      liveStream = connectLiveStream({ dataManager, groupId, kinds: ["encounter", "character"], shareToken });
      liveStream.subscribe("encounter", (payload) => {
        if (state.encounter && payload.id === state.encounter.id) {
          void refreshCurrentEncounter();
        }
      });
      liveStream.subscribe("character", (payload) => {
        void refreshCombatantFromCharacter(payload.id);
      });
    } else {
      liveStream = connectLiveStream({ dataManager, groupId, kinds: ["encounter"], shareToken });
      liveStream.subscribe("encounter", () => {
        void pollActiveEncounter();
      });
    }
  }

  // --- Rendering: shared bits ----------------------------------------------

  function conditionLabel(id) {
    return state.conditions?.find((entry) => entry.id === id)?.label || id;
  }

  function renderAcBadge(combatant) {
    const wrap = el("span", "d-flex align-items-center gap-1 text-body-secondary small");
    wrap.appendChild(icon("tabler:shield"));
    wrap.appendChild(el("span", null, String(combatant.ac ?? 0)));
    return wrap;
  }

  function renderTagBadges(combatant, { removable }) {
    const wrap = el("div", "d-flex flex-wrap gap-1");
    if (!combatant.conditions.length) {
      wrap.appendChild(el("span", "text-body-secondary small", "—"));
      return wrap;
    }
    combatant.conditions.forEach((value) => {
      const badge = el("span", "badge text-bg-secondary d-inline-flex align-items-center gap-1", conditionLabel(value));
      if (removable) {
        const removeBtn = el("button", "btn-close btn-close-white");
        removeBtn.type = "button";
        removeBtn.style.fontSize = "0.55rem";
        removeBtn.setAttribute("aria-label", `Remove ${conditionLabel(value)}`);
        removeBtn.addEventListener("click", () => removeTag(combatant, value));
        badge.appendChild(removeBtn);
      }
      wrap.appendChild(badge);
    });
    return wrap;
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

    const combatantInput = el("input", "form-control form-control-sm flex-shrink-0");
    combatantInput.type = "text";
    combatantInput.setAttribute("list", COMBATANT_DATALIST_ID);
    combatantInput.placeholder = "Character/NPC/monster…";
    combatantInput.style.width = "10rem";

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

  // Synchronous — reads the systems list cached by loadSystemsList() at
  // init time, rather than re-fetching on every render (see systemsList's
  // own comment for why that matters).
  function renderGmSystemPicker() {
    const wrap = el("div");
    wrap.appendChild(el("label", "form-label small mb-1", "System"));
    const select = el("select", "form-select form-select-sm");
    select.appendChild(new Option("None", ""));
    (state.systemsList || []).forEach((entry) => select.appendChild(new Option(entry.title || entry.name || entry.id, entry.id)));
    select.value = state.encounter.systemId || "";
    select.addEventListener("change", () => changeSystem(select.value));
    wrap.appendChild(select);
    return wrap;
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
        void startCombat();
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
  // comment). Positioned on its own at the far right of the meta row.
  function renderVisibilityButton() {
    const button = iconButton(
      state.announced ? "tabler:eye" : "tabler:eye-off",
      state.announced ? "Visible to the table — click to hide" : "Not visible to the table — click to show",
      state.announced ? "btn-primary" : "btn-outline-secondary"
    );
    button.addEventListener("click", () => void toggleVisibility());
    return button;
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
    if (combatant.hidden) left.appendChild(icon("tabler:eye-off"));

    const right = el("span", "d-flex align-items-center gap-2");
    right.appendChild(el("span", "text-body-secondary small", formatHpText(combatant)));
    right.appendChild(renderAcBadge(combatant));
    right.appendChild(renderTagBadges(combatant, { removable: false }));

    row.append(left, right);
    return row;
  }

  // Shown below the list whenever a combatant is selected — no separate
  // Edit button/toolbar; selecting a row IS opening its details. Visible
  // and Delete (previously a separate small toolbar above this panel) now
  // live in its header, next to the Name field.
  function renderCombatantEditPanel() {
    const combatant = selectedCombatant();
    if (!combatant) {
      return null;
    }
    const panel = el("div", "border rounded-3 p-2 d-flex flex-column gap-2");

    const nameRow = el("div", "d-flex gap-2 align-items-center");
    nameRow.appendChild(el("label", "form-label small mb-0", "Name"));
    const nameInput = el("input", "form-control form-control-sm flex-grow-1");
    nameInput.value = combatant.name;
    nameInput.addEventListener("change", () => {
      combatant.name = nameInput.value.trim() || combatant.name;
      markDirty();
    });
    nameRow.appendChild(nameInput);
    const visibleButton = iconButton(
      combatant.hidden ? "tabler:eye-off" : "tabler:eye",
      combatant.hidden ? "Hidden from players — click to reveal" : "Visible to players — click to hide"
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

    const statsRow = el("div", "d-flex gap-2 align-items-center flex-wrap");
    const initWrap = el("div", "d-flex align-items-center gap-1");
    initWrap.appendChild(el("span", "small text-body-secondary", modifierBinding?.name || "Init"));
    const initInput = el("input", "form-control form-control-sm");
    initInput.type = "number";
    initInput.style.width = "4.5rem";
    initInput.value = combatant.initiative;
    initInput.addEventListener("change", () => {
      combatant.initiative = Number(initInput.value) || 0;
      markDirty();
    });
    initWrap.appendChild(initInput);

    const hpWrap = el("div", "d-flex align-items-center gap-1");
    hpWrap.appendChild(el("span", "small text-body-secondary", resourceBinding?.name || "Resource"));
    const hpInput = el("input", "form-control form-control-sm");
    hpInput.type = "number";
    hpInput.style.width = "4.5rem";
    hpInput.value = combatant.hp;
    hpInput.addEventListener("change", () => {
      combatant.hp = Number(hpInput.value) || 0;
      markDirty();
      void writeThroughToCharacter(combatant, { hp: combatant.hp });
    });
    const maxHpInput = el("input", "form-control form-control-sm");
    maxHpInput.type = "number";
    maxHpInput.style.width = "4.5rem";
    maxHpInput.value = combatant.maxHp;
    maxHpInput.addEventListener("change", () => {
      combatant.maxHp = Number(maxHpInput.value) || 0;
      markDirty();
      void writeThroughToCharacter(combatant, { maxHp: combatant.maxHp });
    });
    hpWrap.append(hpInput, el("span", "text-body-secondary", "/"), maxHpInput);

    const tempHpWrap = el("div", "d-flex align-items-center gap-1");
    tempHpWrap.appendChild(el("span", "small text-body-secondary", "Temp"));
    const tempHpInput = el("input", "form-control form-control-sm");
    tempHpInput.type = "number";
    tempHpInput.style.width = "4.5rem";
    tempHpInput.value = combatant.tempHp ?? 0;
    tempHpInput.addEventListener("change", () => {
      combatant.tempHp = Number(tempHpInput.value) || 0;
      markDirty();
      void writeThroughToCharacter(combatant, { tempHp: combatant.tempHp });
    });
    tempHpWrap.appendChild(tempHpInput);

    const acWrap = el("div", "d-flex align-items-center gap-1");
    acWrap.appendChild(el("span", "small text-body-secondary", valueBinding?.name || "Value"));
    const acInput = el("input", "form-control form-control-sm");
    acInput.type = "number";
    acInput.style.width = "4.5rem";
    acInput.value = combatant.ac ?? 0;
    acInput.addEventListener("change", () => {
      combatant.ac = Number(acInput.value) || 0;
      markDirty();
      void writeThroughToCharacter(combatant, { ac: combatant.ac });
    });
    acWrap.appendChild(acInput);

    statsRow.append(initWrap, hpWrap, tempHpWrap, acWrap);

    const tagsSection = el("div", "d-flex flex-column gap-1");
    tagsSection.appendChild(el("span", "small text-body-secondary", "Tags"));
    tagsSection.appendChild(renderTagBadges(combatant, { removable: true }));
    const tagInputRow = el("div", "d-flex gap-1");
    const tagInput = el("input", "form-control form-control-sm");
    tagInput.placeholder = "Add a tag…";
    tagInput.setAttribute("list", TAG_DATALIST_ID);
    const commitTag = () => {
      addTag(combatant, tagInput.value);
      tagInput.value = "";
    };
    tagInput.addEventListener("keydown", (event) => {
      if (event.key === "Enter") {
        event.preventDefault();
        commitTag();
      }
    });
    const addTagButton = el("button", "btn btn-outline-secondary btn-sm", "Add");
    addTagButton.type = "button";
    addTagButton.addEventListener("click", commitTag);
    tagInputRow.append(tagInput, addTagButton);
    tagsSection.appendChild(tagInputRow);

    panel.append(nameRow, statsRow, tagsSection);
    return panel;
  }

  function renderTagDatalist() {
    let datalist = document.getElementById(TAG_DATALIST_ID);
    if (!datalist) {
      datalist = document.createElement("datalist");
      datalist.id = TAG_DATALIST_ID;
      document.body.appendChild(datalist);
    }
    datalist.innerHTML = "";
    (state.conditions || []).forEach((condition) => {
      const option = document.createElement("option");
      option.value = condition.label;
      datalist.appendChild(option);
    });
  }

  // Synchronous, and builds everything into a detached `root` before ever
  // touching `container` — swapping content in one step at the very end
  // (rather than clearing container up front, the old approach) is what
  // stops the whole widget from visibly flashing empty on every click.
  function renderGm() {
    const root = el("div", "combat-tracker-widget d-flex flex-column gap-2");

    const pickerRow = el("div", "d-flex flex-wrap gap-2 align-items-end");
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

    const newButton = el("button", "btn btn-outline-primary btn-sm", "New");
    newButton.type = "button";
    newButton.addEventListener("click", createEncounter);

    pickerRow.append(pickerWrap, newButton);
    root.appendChild(pickerRow);

    if (state.encounter) {
      const metaRow = el("div", "d-flex flex-wrap gap-3 align-items-end justify-content-between");
      metaRow.appendChild(renderGmSystemPicker());
      const rightMeta = el("div", "d-flex align-items-center gap-3");
      if (state.encounter.started) {
        rightMeta.appendChild(el("span", "text-body-secondary small", `Round ${state.encounter.round}`));
      }
      rightMeta.appendChild(renderEncounterToolbar());
      rightMeta.appendChild(renderVisibilityButton());
      metaRow.appendChild(rightMeta);
      root.appendChild(metaRow);

      root.appendChild(el("hr", "my-1"));

      const list = el("div", "list-group");
      state.encounter.combatants.forEach((combatant, index) => {
        list.appendChild(renderCombatantRow(combatant, index));
      });
      if (!state.encounter.combatants.length) {
        list.appendChild(el("p", "text-body-secondary small mb-0", "No combatants yet."));
      }
      root.appendChild(list);

      const editPanel = renderCombatantEditPanel();
      if (editPanel) root.appendChild(editPanel);

      root.appendChild(renderGmAddCombatantRow());
    } else {
      root.appendChild(el("p", "text-body-secondary small mb-0", "Select or create an encounter to start tracking combat."));
    }

    disposeTooltips(container);
    container.innerHTML = "";
    container.appendChild(root);
    renderTagDatalist();
    refreshTooltips(container);
  }

  function renderPlayerCombatantRow(combatant, index) {
    const row = el("div", "list-group-item d-flex justify-content-between align-items-center gap-2");
    if (combatant.hidden) {
      if (state.encounter.started && index === state.encounter.activeIndex) row.appendChild(renderTurnBadge());
      row.appendChild(el("span", null, "—"));
      row.appendChild(el("span", "text-body-secondary fst-italic", "???"));
      return row;
    }
    const left = el("span", "d-flex align-items-center gap-2");
    if (state.encounter.started && index === state.encounter.activeIndex) left.appendChild(renderTurnBadge());
    left.appendChild(el("span", "fw-semibold", String(combatant.initiative)));
    left.appendChild(el("span", null, combatant.name));
    const right = el("span", "d-flex align-items-center gap-2");
    right.appendChild(el("span", "text-body-secondary small", formatHpText(combatant)));
    right.appendChild(renderAcBadge(combatant));
    right.appendChild(renderTagBadges(combatant, { removable: false }));
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
    state.encounter.combatants.forEach((combatant, index) => {
      list.appendChild(renderPlayerCombatantRow(combatant, index));
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
      } else {
        render();
      }
    } else {
      await pollActiveEncounter();
      startPolling();
    }
    startLiveStream();
  }

  void init();

  return {
    destroy() {
      state.destroyed = true;
      stopPolling();
      liveStream?.close();
      container.innerHTML = "";
    },
  };
}
