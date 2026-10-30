// Spotlight resolution — lets Dashboard widgets (Handout/Map/Clock/Browser/
// Calendar/Soundboard/Combat) find out what's currently shown to the active
// player group, via the group's spotlight state (server/spotlight.py). Each
// widget posts/clears its
// own spotlight directly through dataManager.spotlightToGroup/clearSpotlight
// — this module mostly only reads that state back; retirePreviousEncounterSpotlight
// below is the one deliberate exception, enforcing the single-slot
// invariant this file already documents for "encounter" (see
// resolveActiveSpotlightId's own comment) rather than just describing it.
import { loadLibraryData } from "./content-fetch.js";

// Same "category === print" filter as Press's listPrintTemplateEntries
// (press/js/templates.js) — duplicated here rather than importing across
// tool boundaries, since it's the only Press-specific knowledge this shared
// module needs. Exported so handout.js's template picker reuses it too.
export async function listPrintTemplates(dataManager) {
  const listing = await dataManager.list("templates", { refresh: true });
  const entries = dataManager.collectListEntries(listing.remote, ["owned", "shared", "public", "items"]);
  return entries.filter((entry) => (entry.category || "character") === "print");
}

// Kinds with no print-card rendering of their own — Orrery's maps are a
// spatial canvas, not a single-entity card Press can lay out. Spotlighting
// one is just a link back into the owning tool (workbench-character-view.js's
// refreshNowShowing renders these as an "Open" link), so the template
// picker is skipped entirely.
export const LINK_ONLY_KINDS = new Set(["map", "encounter"]);

// What each spotlighted kind is called in "Showed <article> to the table"
// phrasing, and the fallback whenever a real resource title (fetched
// separately) isn't available yet.
export const SPOTLIGHT_KIND_LABELS = {
  npc: "an NPC",
  location: "a Location",
  monster: "a Monster",
  wonder: "a Wonder",
  journal: "a Journal page",
  map: "a Map",
  encounter: "an Encounter",
  clock: "a Clock",
  browser: "a link",
  calendar: "a calendar",
  soundboard: "a soundboard",
  shop: "a Shop",
};

// Mirrors dashboard.js's own WIDGET_CATALOG icon for whichever widget type
// each kind becomes there, kept as its own table since the catalog's icon
// there doubles as "is this addable to a dashboard" — a question that only
// makes sense on the Dashboard, whereas Workbench's read-only "Now Showing"
// panel just needs "what icon represents this kind."
export const SPOTLIGHT_KIND_ICONS = {
  npc: "tabler:file-text",
  location: "tabler:file-text",
  monster: "tabler:file-text",
  wonder: "tabler:file-text",
  journal: "tabler:file-text",
  encounter: "tabler:swords",
  map: "tabler:map-2",
  clock: "tabler:clock",
  browser: "tabler:world",
  calendar: "tabler:calendar-time",
  soundboard: "tabler:music",
  shop: "tabler:building-store",
};

// Kinds with no Library record to fetch a title from at all — spotlighted by
// an id that isn't a `kind/id` Library path. Guards a title-cache fetch that
// would otherwise 404 forever, once per poll. `shop`'s own state lives on the
// Group (shop-transactions.js), not on any one GM's widget instance,
// but there's still no Library record to fetch a title from, so it shares
// this guard — a Shop widget reads its id straight off contentRef.followId.
export const SPOTLIGHT_INLINE_KINDS = new Set(["clock", "browser", "calendar", "soundboard", "shop"]);

// The group's spotlight state, newest-shown first, in the same entry shape
// the Dashboard and Workbench already consume (`payload` holds
// kind/id/templateId/data). Empty on any failure — "nothing shown" is the
// safe reading.
async function fetchSpotlightEntries(dataManager, { groupId, shareToken } = {}) {
  if (!dataManager || (!groupId && !shareToken)) return [];
  try {
    const state = await dataManager.getGroupSpotlights({ groupId, shareToken });
    const items = Array.isArray(state?.items) ? state.items : [];
    return items
      .map((item) => ({ type: "spotlight", payload: item, created_at: item.postedAt }))
      .sort((a, b) => (Date.parse(b.created_at) || 0) - (Date.parse(a.created_at) || 0));
  } catch (error) {
    return [];
  }
}

// "What's the most recently spotlighted thing of this kind" — a SINGLE-SLOT
// resolution for consumers with no specific id to check (Combat Tracker's
// player-mode poll, Character sheet's initiative push — Combat Tracker only
// ever has one instance per dashboard). NOT for a widget type that can have
// multiple simultaneous instances of the same kind — see resolveIsSpotlighted
// below for that; Handout/Map/Clock use it. Returns null if nothing of `kind`
// is currently spotlighted.
async function resolveActiveSpotlightEntry(dataManager, { groupId, shareToken, kind } = {}) {
  const entries = await fetchSpotlightEntries(dataManager, { groupId, shareToken });
  return entries.find((entry) => entry.payload?.kind === kind) || null;
}

export async function resolveActiveSpotlightId(dataManager, { groupId, shareToken, kind } = {}) {
  const entry = await resolveActiveSpotlightEntry(dataManager, { groupId, shareToken, kind });
  return entry?.payload?.id || "";
}

// dataManager.spotlightToGroup only ever adds a spotlight — nothing clears
// whichever encounter was previously shown before a GM starts/switches to a
// new one (via Repository's `encounter:` chip, or Combat Tracker's own "Show
// to table"). "encounter" is single-slot per group (resolveActiveSpotlightId
// above), but the Dashboard's spotlight tray deliberately allows several
// simultaneous entries PER KIND (correct for Handout/Map/Clock), so every
// encounter ever spotlighted would otherwise keep showing there forever.
// Called by both of the only two places an encounter ever becomes newly
// spotlighted, right before their own spotlightToGroup call — a no-op when
// there's nothing previously spotlighted, or it's this same encounter.
export async function retirePreviousEncounterSpotlight(dataManager, { groupId, nextEncounterId }) {
  if (!groupId) return;
  const activeId = await resolveActiveSpotlightId(dataManager, { groupId, kind: "encounter" }).catch(() => "");
  if (activeId && activeId !== nextEncounterId) {
    await dataManager.clearSpotlight({ groupId, kind: "encounter", id: activeId }).catch(() => {});
  }
}

// "Everything currently spotlighted, across every kind" — the full active
// set, unlike every resolver above (each scoped to one `kind` or one
// `(kind, id)`). Needed for spotlight-inbox.js's catch-up scan when a viewer
// first starts watching a group.
export async function resolveActiveSpotlights(dataManager, { groupId, shareToken } = {}) {
  return fetchSpotlightEntries(dataManager, { groupId, shareToken });
}

// "Is THIS SPECIFIC (kind, id) currently shown" — what a widget type with
// multiple simultaneous instances of the same kind needs (two Handouts, two
// Maps, two Clocks — Clock's own kind is ALWAYS "clock" regardless of which
// clock, so a single-slot answer would hide the first one's still-active
// spotlight behind the second's).
async function resolveActiveInstanceEntry(dataManager, { groupId, shareToken, kind, id } = {}) {
  if (!kind || !id) return null;
  const entries = await fetchSpotlightEntries(dataManager, { groupId, shareToken });
  return entries.find((entry) => entry.payload?.kind === kind && entry.payload?.id === id) || null;
}

export async function resolveIsSpotlighted(dataManager, { groupId, shareToken, kind, id } = {}) {
  const entry = await resolveActiveInstanceEntry(dataManager, { groupId, shareToken, kind, id });
  return Boolean(entry);
}

// Same per-instance resolution as resolveIsSpotlighted, but hands back the
// entry's `data` payload instead of a boolean — what a follower of an
// _INLINE_SPOTLIGHT_KINDS widget (Clock, Browser — see server/groups.py)
// reads instead of fetching a Library record, since these kinds have none.
export async function resolveSpotlightData(dataManager, { groupId, shareToken, kind, id } = {}) {
  const entry = await resolveActiveInstanceEntry(dataManager, { groupId, shareToken, kind, id });
  return entry?.payload?.data ?? null;
}

// A spotlight log entry never carries a display title (server/groups.py
// only requires kind+id) — a real name for a Library-backed kind needs a
// separate fetch. Fetch-once, cache, re-render-on-resolve: `ensure(kind,
// id, onLoaded)` kicks off at most one fetch per key; `get(kind, id)` reads
// whatever's cached so far. Shared by dashboard.js's spotlight panel/Game
// Log and Workbench's "Now Showing" panel.
// `getShareToken` is a getter, not a plain value — the active share token
// can change after this cache is created, and every fetch should use
// whatever's current at call time.
export function createSpotlightTitleCache(dataManager, getShareToken) {
  const titleCache = new Map();
  const pendingFetches = new Set();
  function ensure(kind, id, onLoaded) {
    const key = `${kind}:${id}`;
    if (!kind || !id || titleCache.has(key) || pendingFetches.has(key)) return;
    pendingFetches.add(key);
    loadLibraryData(`${kind}/${id}`, dataManager, getShareToken ? getShareToken() : "")
      .then((payload) => {
        titleCache.set(key, payload?.title || payload?.name || "");
        pendingFetches.delete(key);
        onLoaded?.();
      })
      .catch(() => pendingFetches.delete(key));
  }
  function get(kind, id) {
    return titleCache.get(`${kind}:${id}`) || "";
  }
  return { ensure, get };
}

