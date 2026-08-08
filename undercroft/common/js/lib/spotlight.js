// Spotlight resolution — lets Dashboard widgets (Handout/Map/Clock/Browser/
// Calendar/Soundboard/Combat) find out what's currently shown to the active
// campaign group, via the group log's own `spotlight`/`spotlight-update`/
// `spotlight-clear` entries (server/groups.py). Each widget posts and clears
// its own spotlight directly through dataManager.spotlightToGroup/
// clearSpotlight (scoped to its own kind+id) — this module only reads that
// state back, it doesn't post it.

// Same "category === print" filter Press's own listPrintTemplateEntries
// applies (undercroft/press/js/templates.js) — kept as a small, standalone
// duplicate here rather than importing across tool boundaries, since it's
// the only piece of Press-specific knowledge this shared module needs.
// Exported so handout.js's own template picker can reuse it too.
export async function listPrintTemplates(dataManager) {
  const listing = await dataManager.list("templates", { refresh: true });
  const entries = dataManager.collectListEntries(listing.remote, ["owned", "shared", "public", "items"]);
  return entries.filter((entry) => (entry.category || "character") === "print");
}

// Kinds with no print-card rendering of their own — Orrery's maps are a
// spatial, pannable canvas, not a single-entity card Press can lay out.
// Spotlighting one is just a link back into the owning tool (see
// workbench-character-view.js's refreshNowShowing, which renders these as
// an "Open" link instead of fetching+rendering a card), so the template
// picker is irrelevant and skipped entirely rather than shown as a confusing
// dropdown with nothing appropriate to pick.
export const LINK_ONLY_KINDS = new Set(["map", "encounter"]);

// Every lookup below only ever cares about these three entry types — passed
// to getGroupLog's own `types` filter so the LIMIT-bounded window it reads
// is spent entirely on spotlight-relevant rows, not diluted by ordinary
// chat/roll log entries (or, more sharply, a single chatty inline-kind
// widget's own frequent spotlight-update refreshes — a Clock ticking, a
// Browser URL edit — each one its own row). Confirmed cause of a real bug:
// enough of either crowded an unrelated widget's still-active `spotlight`
// entry out of the unfiltered window, making resolveIsSpotlighted wrongly
// report it as no longer shown even though nothing ever cleared it — the
// Dashboard's second-screen mirror going completely blank whenever a Clock
// widget on it had been ticked/edited enough times.
const SPOTLIGHT_LOG_TYPES = ["spotlight", "spotlight-update", "spotlight-clear"];

// "What's the most recently spotlighted thing of this kind, if it's still
// active" — a SINGLE-SLOT resolution, correct for consumers that only ever
// care about one active thing per kind and have no specific id of their own
// to check against (Combat Tracker's player-mode poll, Character sheet's
// initiative push, the Dashboard mirror's Combat Tracker case — all "is
// SOME encounter active, and if so which one," never "is THIS SPECIFIC
// encounter active" since Combat Tracker only ever has one instance per
// dashboard). NOT what a widget type that can have multiple simultaneous
// instances of the same kind needs — see resolveIsSpotlighted below for
// that; Handout/Map/Clock all use that one instead, not this.
//
// Server entries come back oldest-first (server/groups.py's own reversal) —
// sorted newest-first here so "the latest" really is the latest, not just
// the first match in server order. Different kinds are independent —
// spotlighting a Map doesn't affect whether an NPC Handout is still shown,
// and vice versa — so this only ever looks at entries actually ABOUT this
// kind: a `spotlight`/`spotlight-update`/`spotlight-clear` whose own
// payload.kind matches, OR a kind-agnostic `spotlight-clear` (no kind in its
// payload at all — data-manager.js's clearSpotlight supports omitting kind
// for a "clear whatever's shown, of any kind" call, though nothing currently
// posts one; every widget clears its own spotlight by kind+id instead).
// `spotlight-update` (data-manager.js's updateSpotlightData) is a silent
// data refresh on an already-shown inline kind — treated the same as
// `spotlight` for "is this still active" here, so a Clock tick or Browser
// URL edit doesn't read as "no longer shown."
// Returns null if nothing of `kind` is currently spotlighted (either
// nothing ever was, or a later clear — scoped or global — superseded the
// last spotlight of this kind).
async function resolveActiveSpotlightEntry(dataManager, { groupId, shareToken, kind, limit = 100 } = {}) {
  if (!dataManager || (!groupId && !shareToken)) return null;
  try {
    const log = await dataManager.getGroupLog({ groupId, shareToken, limit, types: SPOTLIGHT_LOG_TYPES });
    const entries = Array.isArray(log?.entries) ? log.entries : [];
    entries.sort((a, b) => (Date.parse(b.created_at) || 0) - (Date.parse(a.created_at) || 0));
    const latest = entries.find((entry) => {
      if (entry?.type === "spotlight" || entry?.type === "spotlight-update") return entry.payload?.kind === kind;
      if (entry?.type === "spotlight-clear") return !entry.payload?.kind || entry.payload.kind === kind;
      return false;
    });
    if (!latest || latest.type === "spotlight-clear") {
      return null;
    }
    return latest;
  } catch (error) {
    return null;
  }
}

export async function resolveActiveSpotlightId(dataManager, { groupId, shareToken, kind, limit = 100 } = {}) {
  const entry = await resolveActiveSpotlightEntry(dataManager, { groupId, shareToken, kind, limit });
  return entry?.payload?.id || "";
}

// "Everything currently spotlighted, across every kind" — the full active
// set, unlike every other resolver above (each scoped to one `kind`, or one
// `(kind, id)`, since every existing caller already knows what it's asking
// about). Needed specifically for spotlight-inbox.js's own catch-up scan
// when a viewer first starts watching a group: without this, someone who
// joins after the GM has already spotlighted, say, both a Map AND an NPC
// handout would only ever learn about whichever ONE happens to be the
// single most recent log entry — the other, still-active one stays
// invisible unless they think to check the Game Log by hand (confirmed
// real bug report, not hypothetical).
//
// Same "latest entry per key wins" reconstruction every resolver above
// already does, just applied across every (kind,id) pair the fetched
// window mentions at once instead of one at a time. `limit` defaults higher
// than the single-target resolvers above (200 vs 100) — reconstructing
// several independent keys' worth of history at once needs a wider window
// than settling just one.
export async function resolveActiveSpotlights(dataManager, { groupId, shareToken, limit = 200 } = {}) {
  if (!dataManager || (!groupId && !shareToken)) return [];
  let entries;
  try {
    const log = await dataManager.getGroupLog({ groupId, shareToken, limit, types: SPOTLIGHT_LOG_TYPES });
    entries = Array.isArray(log?.entries) ? log.entries : [];
  } catch (error) {
    return [];
  }
  entries.sort((a, b) => (Date.parse(b.created_at) || 0) - (Date.parse(a.created_at) || 0));
  // Walking newest-first: the FIRST entry seen for a given (kind,id) key is
  // definitionally the latest one for it, so it alone decides whether that
  // key is currently active — every older entry for the same key is
  // skipped via `decided.has(key)`. A kind-wide clear (payload has `kind`
  // but no `id`) retroactively decides every OLDER same-kind spotlight this
  // loop hasn't reached yet as cleared too (clearedKinds), without touching
  // any NEWER same-kind spotlight already resolved active above it. A
  // global clear (no kind at all) stops the walk outright — nothing older
  // than it could still be active.
  const decided = new Map(); // "kind:id" -> true (active) | false (cleared)
  const clearedKinds = new Set();
  const active = [];
  for (const entry of entries) {
    if (entry?.type === "spotlight-clear") {
      const clearKind = entry.payload?.kind;
      const clearId = entry.payload?.id;
      if (!clearKind) break; // Global clear — nothing older survives.
      if (!clearId) {
        clearedKinds.add(clearKind);
        continue;
      }
      const key = `${clearKind}:${clearId}`;
      if (!decided.has(key)) decided.set(key, false);
      continue;
    }
    if (entry?.type !== "spotlight" && entry?.type !== "spotlight-update") continue;
    const kind = String(entry.payload?.kind || "").trim();
    const id = String(entry.payload?.id || "").trim();
    if (!kind || !id) continue;
    const key = `${kind}:${id}`;
    if (decided.has(key)) continue;
    if (clearedKinds.has(kind)) {
      decided.set(key, false);
      continue;
    }
    decided.set(key, true);
    active.push(entry);
  }
  return active;
}

// "Is THIS SPECIFIC (kind, id) currently shown" — what every widget type
// that can have multiple simultaneous instances of the same kind actually
// needs (two different Handouts, two Maps, two Clocks — Clock's own kind is
// ALWAYS "clock" regardless of which clock, so without this, showing a
// second clock made resolveActiveSpotlightId's single-slot answer point at
// the new one, and the first one's own still-active spotlight became
// invisible to it — same shape bug as the cross-kind one above, just within
// one kind). Confirmed bug this fixes: showing a second widget of the same
// kind (or, before the kind-scoping fix above, ANY kind) made an
// already-shown widget disappear even though nothing ever cleared it
// specifically.
//
// An entry is "about" (kind, id) if it's a `spotlight`/`spotlight-update`
// matching both, a `spotlight-clear` matching both (or matching kind with no
// id — a deliberate "clear every instance of this kind," not currently
// posted by anything but supported), or a kind-agnostic `spotlight-clear`
// (matches everything — the same global-clear escape hatch
// resolveActiveSpotlightId honors). The latest such entry decides:
// spotlighted only if it's a `spotlight` or `spotlight-update` (see
// resolveActiveSpotlightEntry's own comment on why the two are equivalent
// here).
async function resolveActiveInstanceEntry(dataManager, { groupId, shareToken, kind, id, limit = 100 } = {}) {
  if (!dataManager || (!groupId && !shareToken) || !kind || !id) return null;
  try {
    const log = await dataManager.getGroupLog({ groupId, shareToken, limit, types: SPOTLIGHT_LOG_TYPES });
    const entries = Array.isArray(log?.entries) ? log.entries : [];
    entries.sort((a, b) => (Date.parse(b.created_at) || 0) - (Date.parse(a.created_at) || 0));
    const latest = entries.find((entry) => {
      if (entry?.type === "spotlight" || entry?.type === "spotlight-update") {
        return entry.payload?.kind === kind && entry.payload?.id === id;
      }
      if (entry?.type === "spotlight-clear") {
        const clearKind = entry.payload?.kind;
        if (!clearKind) return true; // Global clear — matches every (kind, id).
        if (clearKind !== kind) return false;
        const clearId = entry.payload?.id;
        return !clearId || clearId === id; // Kind-wide clear, or this exact instance.
      }
      return false;
    });
    return latest && latest.type !== "spotlight-clear" ? latest : null;
  } catch (error) {
    return null;
  }
}

export async function resolveIsSpotlighted(dataManager, { groupId, shareToken, kind, id, limit = 100 } = {}) {
  const entry = await resolveActiveInstanceEntry(dataManager, { groupId, shareToken, kind, id, limit });
  return Boolean(entry);
}

// Same per-instance resolution as resolveIsSpotlighted, but hands back the
// entry's own `data` payload instead of a boolean — what a follower of an
// _INLINE_SPOTLIGHT_KINDS widget (Clock, Browser — see server/groups.py's
// own comment) reads instead of fetching a Library record, since these
// kinds have none. Picks up the latest `data`, whether it came from the
// original `spotlight` entry or a later `spotlight-update` refresh.
export async function resolveSpotlightData(dataManager, { groupId, shareToken, kind, id, limit = 100 } = {}) {
  const entry = await resolveActiveInstanceEntry(dataManager, { groupId, shareToken, kind, id, limit });
  return entry?.payload?.data ?? null;
}

