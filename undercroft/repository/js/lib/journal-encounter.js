// Inline `` `encounter: 1: Giant Shark, 2: Merfolk` `` blocks — parsed here,
// rendered as a clickable chip by markdown.js's applyEncounterBlocks (same
// "post-process a rendered <code> element" pattern journal-dice.js already
// uses for `dice:` blocks). Clicking one builds and starts a real Combat
// Tracker encounter from the parsed creature list, instead of the GM
// re-typing it by hand into the tracker.
import { fetchKindEntriesWithIds } from "../../../common/js/lib/content-fetch.js";
import { loadSystemFields, deriveCombatBindings, resolveCombatantStats } from "../../../common/js/lib/widgets/combat-bindings.js";
import { uniquifyCombatantName } from "../../../common/js/lib/widgets/combatant-naming.js";
import { fetchGroupMemberCharacters } from "../../../common/js/lib/widgets/group-context.js";
import { retirePreviousEncounterSpotlight } from "../../../common/js/lib/spotlight.js";
import { resolveToolHref } from "../../../common/js/lib/app-shell.js";
import { pingForDashboardTab, requestDashboardFocus } from "../../../common/js/lib/dashboard-channel.js";
import { setElementVisible } from "../../../common/js/lib/dom.js";

function randomId() {
  if (typeof crypto !== "undefined" && typeof crypto.randomUUID === "function") {
    return crypto.randomUUID();
  }
  return `${Math.random().toString(16).slice(2)}-${Date.now()}`;
}

const QTY_NAME_PATTERN = /^\s*(\d+)\s*:\s*(.+)$/;

// "1: Giant Shark, 2: Merfolk, 4: Sahuagin" -> [{qty, name}, ...]. A bare
// name with no leading "qty:" is tolerated as quantity 1.
export function parseEncounterBlock(text) {
  return String(text || "")
    .split(",")
    .map((segment) => segment.trim())
    .filter(Boolean)
    .map((segment) => {
      const match = QTY_NAME_PATTERN.exec(segment);
      if (match) {
        return { qty: Math.max(1, parseInt(match[1], 10) || 1), name: match[2].trim() };
      }
      return { qty: 1, name: segment };
    })
    .filter((entry) => entry.name);
}

// Case-insensitive exact-name match only — no fuzzy matching exists anywhere
// in this suite; an unmatched name falls back to Freeform, not a near-miss
// guess. Also used by journal-kind-reference.js's Related-panel resolution.
export function findMatch(name, monsters, npcs) {
  const lower = name.trim().toLowerCase();
  const monsterMatch = monsters.find((entry) => (entry.entity?.name || "").trim().toLowerCase() === lower);
  if (monsterMatch) return { kind: "monster", id: monsterMatch.id, payload: monsterMatch.entity || {} };
  const npcMatch = npcs.find((entry) => (entry.entity?.name || "").trim().toLowerCase() === lower);
  if (npcMatch) return { kind: "npc", id: npcMatch.id, payload: npcMatch.entity || {} };
  return null;
}

// Appends " 2", " 3", ... only when `name` collides — never touches an
// existing name. Deliberately asymmetric with uniquifyCombatantName (which
// DOES rename a pre-existing sibling): encounters are independent, persisted
// records other things may already reference by name, so silently renaming
// one as a side effect of creating another would be a much bigger surprise
// than renumbering a combatant row in the same list.
export function uniquifyEncounterName(name, existingNames) {
  const base = String(name || "").trim() || "New Encounter";
  const taken = new Set((existingNames || []).map((n) => String(n || "").trim().toLowerCase()));
  if (!taken.has(base.toLowerCase())) return base;
  let n = 2;
  while (taken.has(`${base} ${n}`.toLowerCase())) n += 1;
  return `${base} ${n}`;
}

// Every encounter this GM can currently see — list metadata only, matching
// Combat Tracker's own loadOwnedEncounters. `excludeId` leaves out the
// encounter about to be saved under that id, so restarting it isn't treated
// as colliding with its own previous save.
async function loadExistingEncounterNames(dataManager, excludeId) {
  try {
    const listing = await dataManager.list("encounter", { refresh: true });
    return dataManager
      .collectListEntries(listing.remote, ["owned", "shared", "public", "items"])
      .filter((entry) => entry.id !== excludeId)
      .map((entry) => entry.title || entry.name || "");
  } catch (error) {
    return [];
  }
}

// Without this, a page with many `encounter:` blocks produces a run of
// identically-named encounters in Combat Tracker's list. Appending creature
// names (not quantities — the combatant list already shows those) gives
// each one a name that says what it is at a glance.
function creatureNameSummary(creatures) {
  return (creatures || []).map((creature) => creature.name).join(", ");
}

// Resolves a parsed creature list against monster/NPC records and
// combatBindings-driven stats — shared by buildEncounterPayload (a brand
// new encounter) and addCreaturesToEncounter (adding to one already
// running) below, so both paths match/resolve creatures identically.
// `systemIdHint`, when given, is used as-is instead of inferred from the
// matches — addCreaturesToEncounter passes the TARGET encounter's own
// System, so combatBindings/stat resolution stays consistent with whatever
// combatants are already on its sheet rather than drifting to whatever the
// newly-added creatures happen to imply.
async function buildCombatantsFromCreatures(creatures, { dataManager, systemIdHint = "" } = {}) {
  const [monsters, npcs] = await Promise.all([
    fetchKindEntriesWithIds(dataManager, "monster").catch(() => []),
    fetchKindEntriesWithIds(dataManager, "npc").catch(() => []),
  ]);
  const matches = creatures.map((creature) => ({ creature, match: findMatch(creature.name, monsters, npcs) }));
  // The whole encounter shares one System, inferred from the first matched
  // creature that carries one when no hint is given; an all-Freeform block
  // leaves it blank, same as a manually-created blank encounter.
  const systemId = systemIdHint || matches.map(({ match }) => match?.payload?.systemIds?.[0]).find(Boolean) || "";
  const fields = await loadSystemFields(dataManager, systemId);
  const combatBindings = deriveCombatBindings(fields);

  const combatants = [];
  matches.forEach(({ creature, match }) => {
    const qty = Math.max(1, Number(creature.qty) || 1);
    for (let i = 0; i < qty; i += 1) {
      const stats = match
        ? resolveCombatantStats(combatBindings, match.payload)
        : { hp: 0, maxHp: 0, tempHp: 0, ac: 0, hpResourceName: "", resources: [] };
      const baseName = match ? match.payload?.name || match.payload?.title || creature.name : creature.name;
      combatants.push({
        id: randomId(),
        name: uniquifyCombatantName(baseName, combatants),
        refKind: match?.kind || null,
        refId: match?.id || null,
        initiative: 0,
        hp: stats.hp,
        maxHp: stats.maxHp,
        tempHp: stats.tempHp,
        ac: stats.ac,
        // See combat-tracker.js's own addCombatant comment.
        hpResourceName: stats.hpResourceName,
        resources: stats.resources,
        conditions: [],
        isPc: false,
        hidden: false,
      });
    }
  });
  return { combatants, systemId, combatBindings };
}

// PC combatants for "also add the party" (the Start Encounter modal's own
// checkbox) and for Combat Tracker's Add Party button's own equivalent —
// resolves each member character's CURRENT stats the same way a manual Add
// Combatant does (resolveCombatantStats against the live character record),
// so a wounded PC shows up already at their current HP, not full.
// `alreadyPresent` is whatever combatants this batch is being added
// alongside (a brand new encounter's own freshly-built creature list, or an
// already-running encounter's existing roster) — any party member whose
// character is already in there (matched by refId) is skipped, so "also add
// the party" / Add Party never duplicates someone already at the table.
async function buildPartyCombatants(dataManager, groupId, combatBindings, alreadyPresent = []) {
  const members = await fetchGroupMemberCharacters(dataManager, groupId);
  const existingCharacterIds = new Set(
    alreadyPresent.filter((combatant) => combatant.refKind === "character").map((combatant) => combatant.refId)
  );
  const toAdd = members.filter((member) => !existingCharacterIds.has(member.id));
  if (!toAdd.length) return [];
  const statsList = await Promise.all(
    toAdd.map((member) =>
      dataManager
        .get("character", member.id, { preferLocal: false })
        .then((result) => resolveCombatantStats(combatBindings, result.payload || {}))
        .catch(() => ({ hp: 0, maxHp: 0, tempHp: 0, ac: 0, hpResourceName: "", resources: [] }))
    )
  );
  const combatants = [];
  toAdd.forEach((member, index) => {
    const stats = statsList[index];
    combatants.push({
      id: randomId(),
      name: uniquifyCombatantName(member.name, [...alreadyPresent, ...combatants]),
      refKind: "character",
      refId: member.id,
      initiative: 0,
      hp: stats.hp,
      maxHp: stats.maxHp,
      tempHp: stats.tempHp,
      ac: stats.ac,
      hpResourceName: stats.hpResourceName,
      resources: stats.resources,
      conditions: [],
      isPc: true,
      hidden: false,
    });
  });
  return combatants;
}

// Builds a full encounter payload (blankEncounter()'s shape) from a parsed
// creature list — matched entries resolve HP/AC through the same
// combat-bindings.js the manual "Add Combatant" flow uses; unmatched names
// become Freeform combatants (refKind/refId null, hp/maxHp/ac 0). Every
// pushed combatant goes through uniquifyCombatantName, so "4: Sahuagin"
// becomes "Sahuagin 1".."Sahuagin 4". `includeParty`/`groupId` are the Start
// Encounter modal's "Also add the party" checkbox — see buildPartyCombatants.
//
// `id`, if given, is used as-is (see startEncounter's deterministic id) so
// re-clicking the same block updates the same record instead of duplicating.
export async function buildEncounterPayload({ title, creatures, dataManager, id, includeParty = false, groupId = "" }) {
  const encounterId = id || randomId();
  const [existingNames, creatureResult] = await Promise.all([
    loadExistingEncounterNames(dataManager, encounterId),
    buildCombatantsFromCreatures(creatures, { dataManager }),
  ]);
  const { combatants, systemId, combatBindings } = creatureResult;
  if (includeParty && groupId) {
    combatants.push(...(await buildPartyCombatants(dataManager, groupId, combatBindings, combatants)));
  }

  const summary = creatureNameSummary(creatures);
  const baseName = title && summary ? `${title} — ${summary}` : title || summary || "New Encounter";
  return {
    id: encounterId,
    name: uniquifyEncounterName(baseName, existingNames),
    groupId: "",
    systemId,
    started: false,
    round: 1,
    activeIndex: 0,
    combatants,
  };
}

// The Start Encounter modal's "Add to the running encounter" choice —
// appends the parsed creatures (and optionally the party) onto an ALREADY
// saved encounter instead of building a brand new one. Reuses the running
// encounter's own System (buildCombatantsFromCreatures's systemIdHint)
// rather than re-inferring one from the newly-added creatures, and
// re-uniquifies each new name against the encounter's CURRENT roster (not
// just the new arrivals), so a name colliding with someone already there
// still numbers correctly.
export async function addCreaturesToEncounter({ dataManager, encounterId, creatures, includeParty = false, groupId = "" }) {
  const existing = await dataManager.get("encounter", encounterId, { preferLocal: false });
  const payload = existing.payload || {};
  const combatants = Array.isArray(payload.combatants) ? payload.combatants.slice() : [];
  let combatBindings = null;
  if (creatures?.length) {
    const result = await buildCombatantsFromCreatures(creatures, { dataManager, systemIdHint: payload.systemId });
    combatBindings = result.combatBindings;
    result.combatants.forEach((combatant) => {
      combatant.name = uniquifyCombatantName(combatant.name, combatants);
      combatants.push(combatant);
    });
  }
  if (includeParty && groupId) {
    if (!combatBindings) {
      combatBindings = deriveCombatBindings(await loadSystemFields(dataManager, payload.systemId));
    }
    combatants.push(...(await buildPartyCombatants(dataManager, groupId, combatBindings, combatants)));
  }
  await dataManager.save("encounter", encounterId, { ...payload, combatants });
  return encounterId;
}

// A stable id derived from which journal page + which encounter block
// (0-based) was clicked, so re-clicking the same chip restarts that same
// record instead of piling up duplicates. Reordering blocks on the page
// shifts this — an accepted trade-off vs. tracking a stable id per block.
export function deterministicEncounterId(pageId, blockIndex) {
  return `journalEncounter_${pageId}_${blockIndex}`;
}

const START_ENCOUNTER_MODAL_ID = "journal-start-encounter-modal";

// A real Bootstrap modal (not a lightweight custom popover) — asks two
// independent questions every time a chip is clicked (never just on
// conflict, per the "I want this as a general modal" ask): which encounter
// (only shown when a different one is already running) and which
// destination. Lazily created and cached on document.body — this module is
// shared by Repository's editor, Handout's widget, and Board's widget (all
// three tools' own bundles), so this singleton simply lives wherever the
// first click happens to occur.
function getOrCreateStartEncounterModal() {
  let modal = document.getElementById(START_ENCOUNTER_MODAL_ID);
  if (modal) return modal;
  const wrapper = document.createElement("div");
  wrapper.innerHTML = `
    <div class="modal fade" id="${START_ENCOUNTER_MODAL_ID}" tabindex="-1" aria-hidden="true">
      <div class="modal-dialog modal-dialog-centered">
        <div class="modal-content">
          <div class="modal-header">
            <h1 class="modal-title fs-5">Start Encounter</h1>
            <button type="button" class="btn-close" data-bs-dismiss="modal" aria-label="Close"></button>
          </div>
          <div class="modal-body d-flex flex-column gap-3">
            <div class="small text-body-secondary" data-encounter-modal-summary></div>
            <div class="d-none" data-encounter-modal-conflict>
              <div class="form-label mb-1">This encounter</div>
              <div class="form-check">
                <input class="form-check-input" type="radio" name="encounter-modal-mode" id="encounter-modal-mode-new" value="new" checked>
                <label class="form-check-label" for="encounter-modal-mode-new">Start a new encounter</label>
              </div>
              <div class="form-check">
                <input class="form-check-input" type="radio" name="encounter-modal-mode" id="encounter-modal-mode-add" value="add">
                <label class="form-check-label" for="encounter-modal-mode-add" data-encounter-modal-add-label>Add to the running encounter</label>
              </div>
            </div>
            <div class="form-check" data-encounter-modal-party>
              <input class="form-check-input" type="checkbox" id="encounter-modal-party">
              <label class="form-check-label" for="encounter-modal-party">Also add the party (PCs)</label>
            </div>
            <div>
              <div class="form-label mb-1">Open in</div>
              <!-- Listed first (when it's even present) since it's the most
                   specific, most likely-wanted choice once a Dashboard tab
                   has actually answered — see promptStartEncounterOptions'
                   own handling of this radio's default-checked state. -->
              <div class="form-check d-none" data-encounter-modal-existing-tab>
                <input class="form-check-input" type="radio" name="encounter-modal-destination" id="encounter-modal-dest-existing-tab" value="existing-tab">
                <label class="form-check-label" for="encounter-modal-dest-existing-tab">My open Dashboard tab</label>
              </div>
              <div class="form-check">
                <input class="form-check-input" type="radio" name="encounter-modal-destination" id="encounter-modal-dest-new-tab" value="new-tab" checked>
                <label class="form-check-label" for="encounter-modal-dest-new-tab">A new tab</label>
              </div>
              <div class="form-check">
                <input class="form-check-input" type="radio" name="encounter-modal-destination" id="encounter-modal-dest-this-tab" value="this-tab">
                <label class="form-check-label" for="encounter-modal-dest-this-tab">This tab</label>
              </div>
            </div>
          </div>
          <div class="modal-footer">
            <button type="button" class="btn btn-outline-secondary" data-bs-dismiss="modal">Cancel</button>
            <button type="button" class="btn btn-primary" data-encounter-modal-submit>Start Encounter</button>
          </div>
        </div>
      </div>
    </div>
  `;
  modal = wrapper.firstElementChild;
  document.body.appendChild(modal);
  return modal;
}

// Built once (element refs + permanent listeners); promptStartEncounterOptions
// below just repopulates its content and hands it a fresh `resolve` each
// time it's opened, rather than re-attaching listeners per call (which would
// stack duplicates across repeated chip clicks on this one singleton element).
let startEncounterModalRefs = null;

function ensureStartEncounterModal() {
  if (startEncounterModalRefs) return startEncounterModalRefs;
  const modal = getOrCreateStartEncounterModal();
  const refs = {
    modal,
    summaryEl: modal.querySelector("[data-encounter-modal-summary]"),
    conflictWrap: modal.querySelector("[data-encounter-modal-conflict]"),
    addLabel: modal.querySelector("[data-encounter-modal-add-label]"),
    partyWrap: modal.querySelector("[data-encounter-modal-party]"),
    partyCheckbox: modal.querySelector("#encounter-modal-party"),
    existingTabWrap: modal.querySelector("[data-encounter-modal-existing-tab]"),
    existingTabRadio: modal.querySelector("#encounter-modal-dest-existing-tab"),
    newTabRadio: modal.querySelector("#encounter-modal-dest-new-tab"),
    submitButton: modal.querySelector("[data-encounter-modal-submit]"),
    modeNewRadio: modal.querySelector("#encounter-modal-mode-new"),
    modeAddRadio: modal.querySelector("#encounter-modal-mode-add"),
    hasConflict: false,
    // Whether the GM has touched a destination radio themselves this
    // opening — guards the ping-driven auto-select below from clobbering a
    // choice they already made in the brief window before a Dashboard tab answers.
    destinationTouched: false,
    resolve: null,
  };
  // "Also add the party" only applies to a brand new encounter (per the
  // ask) — hidden whenever "Add to the running encounter" is selected,
  // rather than left visible-but-meaningless. Its own checked state tracks
  // the mode too — on by default for a new encounter, off (and inert) for
  // "add to running," rather than remembering whatever it was left at.
  function currentMode() {
    return refs.hasConflict && refs.modeAddRadio.checked ? "add" : "new";
  }
  function refreshDependentUi() {
    const mode = currentMode();
    setElementVisible(refs.partyWrap, mode === "new", "block");
    refs.partyCheckbox.checked = mode === "new";
    refs.submitButton.textContent = mode === "add" ? "Add Combatants" : "Start Encounter";
  }
  refs.modeNewRadio.addEventListener("change", refreshDependentUi);
  refs.modeAddRadio.addEventListener("change", refreshDependentUi);
  refs.refreshDependentUi = refreshDependentUi;
  modal.querySelectorAll('input[name="encounter-modal-destination"]').forEach((radio) => {
    radio.addEventListener("change", () => {
      refs.destinationTouched = true;
    });
  });

  refs.submitButton.addEventListener("click", () => {
    const mode = currentMode();
    const destination = modal.querySelector('input[name="encounter-modal-destination"]:checked')?.value || "new-tab";
    const includeParty = mode === "new" && refs.partyCheckbox.checked;
    const resolve = refs.resolve;
    refs.resolve = null;
    window.bootstrap?.Modal?.getOrCreateInstance(modal)?.hide();
    resolve?.({ mode, destination, includeParty });
  });
  // Cancel / the X button / Escape / a backdrop click all end up here
  // WITHOUT going through the submit handler above — resolves with null
  // (the caller treats that as "cancelled") so the returned promise never hangs.
  modal.addEventListener("hidden.bs.modal", () => {
    const resolve = refs.resolve;
    refs.resolve = null;
    resolve?.(null);
  });
  startEncounterModalRefs = refs;
  return refs;
}

// `conflict`, when given, is `{id, name}` for a different, already-STARTED
// encounter — offering "add to it" alongside "start new" instead of quietly
// overriding it. Resolves `null` on Cancel/Escape/backdrop-dismiss.
async function promptStartEncounterOptions({ summary, conflict }) {
  const refs = ensureStartEncounterModal();
  refs.summaryEl.textContent = summary || "";
  refs.hasConflict = Boolean(conflict);
  refs.conflictWrap.classList.toggle("d-none", !conflict);
  refs.modeNewRadio.checked = true;
  refs.modeAddRadio.checked = false;
  if (conflict) {
    refs.addLabel.textContent = `Add to "${conflict.name}" (already running)`;
  }
  refs.existingTabWrap.classList.add("d-none");
  refs.existingTabRadio.checked = false;
  refs.newTabRadio.checked = true;
  refs.destinationTouched = false;
  refs.refreshDependentUi(); // also sets the party checkbox's own mode-based default

  // Best-effort — the "My open Dashboard tab" option only appears (and is
  // selected by default) once one actually answers, rather than being
  // present-but-always-failing when none does (see dashboard-channel.js's
  // own comment on why this can't be known any more directly than pinging
  // for it). Guarded by destinationTouched so a GM who already picked
  // something in that brief window keeps their own choice.
  void pingForDashboardTab().then((found) => {
    if (!found) return;
    refs.existingTabWrap.classList.remove("d-none");
    if (!refs.destinationTouched) refs.existingTabRadio.checked = true;
  });

  return new Promise((resolve) => {
    refs.resolve = resolve;
    window.bootstrap?.Modal?.getOrCreateInstance(refs.modal)?.show();
  });
}

// The modal's own destination choice, applied — "existing-tab" falls back to
// "new-tab" (with a status message) if nothing acknowledges the hand-off,
// e.g. the tab detected when the modal opened has since been closed.
async function navigateToEncounter({ encounterId, destination, currentSection, status }) {
  if (destination === "existing-tab") {
    const handled = await requestDashboardFocus(encounterId);
    if (handled) return;
    status?.show("No open Dashboard tab responded — opened a new tab instead.", { type: "info", timeout: 3500 });
    destination = "new-tab";
  }
  const url = `${resolveToolHref("home", currentSection)}?encounter=${encodeURIComponent(encounterId)}`;
  if (destination === "new-tab") {
    window.open(url, "_blank", "noopener");
    return;
  }
  // "this-tab" — a same-page reload if already on the Dashboard, or a real
  // navigation from any other tool.
  if (currentSection === "home") {
    window.location.search = `?encounter=${encodeURIComponent(encounterId)}`;
  } else {
    window.location.href = url;
  }
}

// The GM's own most-recently-touched STARTED encounter (any — Start Combat
// and "show to table" are deliberately independent toggles with zero
// automatic coupling, see combat-tracker.js's own startCombat/showToTable
// split, so this is spotlight-agnostic on purpose: a GM can be running an
// encounter privately, never shown to the table, and still get offered "add
// to it" here), other than `excludeId` (this same block's own encounter —
// restarting it is just a reset, not a conflict with something else).
// `started` is a declared metadataField (common/data/kind/encounter.json),
// so owned list entries already carry it — no per-item fetch needed. Owned
// entries are also already ordered by modified_at DESC server-side
// (storage.py's own list query), so the first match found really is the
// most recently active one.
async function findRunningOwnedEncounter(dataManager, excludeId) {
  const listing = await dataManager.list("encounter", { refresh: true }).catch(() => null);
  const owned = dataManager.collectListEntries(listing?.remote, ["owned"]);
  const running = owned.find((entry) => entry?.id && entry.id !== excludeId && entry.started);
  return running ? { id: running.id, name: running.title || running.name || "Untitled encounter" } : null;
}

// Orchestrates "click a chip -> real running encounter", shared by
// Repository's editor and Handout's/Board's dashboard-hosted renders.
// Always prompts (promptStartEncounterOptions) rather than only on conflict —
// the modal's destination choice is useful on every click, not just an
// override — then builds either a brand new encounter or appends onto an
// already-running one, per the modal's own choice.
export async function startEncounter({ dataManager, status, title, creatures, groupId, currentSection, id }) {
  if (!groupId) {
    status?.show("No active campaign to start this in.", { type: "warning" });
    return;
  }
  if (!creatures || !creatures.length) return;
  try {
    const conflict = await findRunningOwnedEncounter(dataManager, id);
    const choice = await promptStartEncounterOptions({ summary: creatureNameSummary(creatures), conflict });
    if (!choice) return; // cancelled

    let encounterId;
    if (choice.mode === "add" && conflict) {
      encounterId = await addCreaturesToEncounter({
        dataManager,
        encounterId: conflict.id,
        creatures,
        includeParty: choice.includeParty,
        groupId,
      });
    } else {
      const payload = await buildEncounterPayload({ title, creatures, dataManager, id, includeParty: choice.includeParty, groupId });
      const { id: _id, ...body } = payload;
      await dataManager.save("encounter", payload.id, body);
      encounterId = payload.id;
    }
    await retirePreviousEncounterSpotlight(dataManager, { groupId, nextEncounterId: encounterId });
    await dataManager.spotlightToGroup({ groupId, contentType: "encounter", contentId: encounterId });
    await navigateToEncounter({ encounterId, destination: choice.destination, currentSection, status });
  } catch (error) {
    status?.show(error?.message || "Unable to start the encounter.", { type: "error" });
  }
}
