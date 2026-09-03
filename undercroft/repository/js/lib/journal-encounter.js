// Inline `` `encounter: 1: Giant Shark, 2: Merfolk` `` blocks — parsed here,
// rendered as a clickable chip by markdown.js's applyEncounterBlocks (same
// "post-process a rendered <code> element" pattern journal-dice.js already
// uses for `dice:` blocks). Clicking one builds and starts a real Combat
// Tracker encounter from the parsed creature list, instead of the GM
// re-typing it by hand into the tracker.
import { fetchKindEntriesWithIds } from "../../../common/js/lib/content-fetch.js";
import { loadSystemFields, deriveCombatBindings, resolveCombatantStats } from "../../../common/js/lib/widgets/combat-bindings.js";
import { uniquifyCombatantName } from "../../../common/js/lib/widgets/combatant-naming.js";
import { resolveActiveSpotlightId } from "../../../common/js/lib/spotlight.js";
import { resolveToolContextPath, resolveToolHref } from "../../../common/js/lib/app-shell.js";

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

// Builds a full encounter payload (blankEncounter()'s shape) from a parsed
// creature list — matched entries resolve HP/AC through the same
// combat-bindings.js the manual "Add Combatant" flow uses; unmatched names
// become Freeform combatants (refKind/refId null, hp/maxHp/ac 0). Every
// pushed combatant goes through uniquifyCombatantName, so "4: Sahuagin"
// becomes "Sahuagin 1".."Sahuagin 4".
//
// `id`, if given, is used as-is (see startEncounter's deterministic id) so
// re-clicking the same block updates the same record instead of duplicating.
export async function buildEncounterPayload({ title, creatures, dataManager, id }) {
  const encounterId = id || randomId();
  const [monsters, npcs, existingNames] = await Promise.all([
    fetchKindEntriesWithIds(dataManager, "monster").catch(() => []),
    fetchKindEntriesWithIds(dataManager, "npc").catch(() => []),
    loadExistingEncounterNames(dataManager, encounterId),
  ]);
  const matches = creatures.map((creature) => ({ creature, match: findMatch(creature.name, monsters, npcs) }));
  // The whole encounter shares one System, inferred from the first matched
  // creature that carries one; an all-Freeform block leaves it blank, same
  // as a manually-created blank encounter.
  const systemId = matches.map(({ match }) => match?.payload?.systemIds?.[0]).find(Boolean) || "";
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

// A stable id derived from which journal page + which encounter block
// (0-based) was clicked, so re-clicking the same chip restarts that same
// record instead of piling up duplicates. Reordering blocks on the page
// shifts this — an accepted trade-off vs. tracking a stable id per block.
export function deterministicEncounterId(pageId, blockIndex) {
  return `journalEncounter_${pageId}_${blockIndex}`;
}

// Orchestrates "click a chip -> real running encounter", shared by
// Repository's editor and Handout's dashboard-hosted render. Navigation
// always ends up loading a Dashboard URL with `?encounter=<id>` —
// dashboard.js's own boot logic ensures a Combat Tracker widget exists and
// retargets it. The only branch is which URL: same-page reload if already
// on the Dashboard, or a real navigation from any other tool.
export async function startEncounter({ dataManager, status, title, creatures, groupId, currentSection, id }) {
  if (!groupId) {
    status?.show("No active campaign to start this in.", { type: "warning" });
    return;
  }
  if (!creatures || !creatures.length) return;
  try {
    const activeId = await resolveActiveSpotlightId(dataManager, { groupId, kind: "encounter" });
    // Only a genuinely DIFFERENT running encounter needs a confirmation —
    // restarting this same block's own encounter (already active) is just a
    // reset, not an override of something else.
    if (activeId && activeId !== id) {
      const active = await dataManager.get("encounter", activeId, { preferLocal: false }).catch(() => null);
      if (active?.payload?.started) {
        const proceed = window.confirm("An encounter is already running for this campaign. Start this one instead?");
        if (!proceed) return;
      }
    }
    const payload = await buildEncounterPayload({ title, creatures, dataManager, id });
    const { id: _id, ...body } = payload;
    await dataManager.save("encounter", payload.id, body);
    await dataManager.spotlightToGroup({ groupId, contentType: "encounter", contentId: payload.id });
    if (resolveToolContextPath() === "home") {
      window.location.search = `?encounter=${encodeURIComponent(payload.id)}`;
    } else {
      window.location.href = `${resolveToolHref("home", currentSection)}?encounter=${encodeURIComponent(payload.id)}`;
    }
  } catch (error) {
    status?.show(error?.message || "Unable to start the encounter.", { type: "error" });
  }
}
