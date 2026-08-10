// Shared owner-or-admin delete-permission logic. Extracted from 7 near-
// identical copies (Loom's systemAllowsDelete/libraryEntryAllowsDelete,
// Sanctum's settingAllowsDelete/locationAllowsDelete, Orrery's
// mapAllowsDelete, Press's templateAllowsDelete, Workbench's
// templateOwnerMatchesCurrentUser), each of which had a comment admitting it
// copied one of the others. See undercroft/README.md's Code Conventions section.
//
// Two shapes are supported because two call patterns exist in the suite:
//   - most tools keep a `Map` of ownership metadata (id -> {ownerId,
//     ownerUsername, permissions, ownership}) refreshed via
//     refreshOwnershipCatalog(), then call allowsDelete(catalog, id, ...).
//   - Press already has the metadata object in hand (the active template
//     itself) and calls allowsDeleteForRecord(metadata, ...) directly.
// Workbench's templateOwnerMatchesCurrentUser is a genuinely different job —
// a pure "does this user own it" check reused for edit-gating (broader than
// delete-gating, and without the admin bypass baked in, since Workbench's own
// call sites apply that separately) — so only its owner-matching tail is
// shared, via matchesOwner().

// True if `user` (from dataManager.session) matches the metadata's owner, by
// id first, then by username. No admin/local/edit-permission shortcuts here —
// callers decide whether those apply for their own use case.
export function matchesOwner(metadata, { session } = {}) {
  const user = session?.user;
  if (!user) return false;
  const ownerId = metadata?.ownerId ?? metadata?.owner_id ?? null;
  if (ownerId !== null && ownerId !== undefined && user.id !== undefined && user.id !== null) {
    if (String(ownerId) === String(user.id)) return true;
  }
  const ownerUsername = metadata?.ownerUsername || metadata?.owner_username || "";
  if (ownerUsername && user.username) {
    return ownerUsername.toLowerCase() === user.username.toLowerCase();
  }
  return false;
}

// Owner-or-admin, same rule as everywhere else in the suite: an admin can
// delete/act on any record regardless of ownership; otherwise the record must
// be local-only (always deletable — it's just this browser's own storage), a
// shared-with-edit-permission entry, or actually owned (by id or username) by
// the signed-in user.
function ownerOrAdminAllows(metadata, { dataManager } = {}) {
  if (dataManager?.getUserTier() === "admin") return true;
  if (!metadata) return false;
  if (metadata.ownership === "local") return true;
  if (metadata.permissions === "edit") return true;
  if (!dataManager?.isAuthenticated?.()) return false;
  return matchesOwner(metadata, { session: dataManager?.session });
}

export function allowsDelete(catalog, id, { dataManager } = {}) {
  if (!id) return false;
  return ownerOrAdminAllows(catalog?.get(id), { dataManager });
}

export function allowsDeleteForRecord(metadata, { dataManager } = {}) {
  return ownerOrAdminAllows(metadata, { dataManager });
}

// Ownership metadata comes from a dedicated dataManager.list() call (not the
// full fetched body of each record) — cheap enough to refresh whenever the
// picker for `kind` repopulates. Local-only (anonymous, browser-storage)
// entries are included too and tagged `ownership: "local"` — always
// deletable, since it's just the current browser's own storage with no real
// access-control question.
// The owner-or-admin confirm()-before-delete dialog, repeated at 16 call
// sites across the suite with slightly varying wording — one shared prompt
// so the wording stays consistent everywhere, and any future change (a
// custom modal instead of window.confirm, say) lands in one place. `label`
// is whatever the caller already uses to identify the record to the user
// (a name, a title, "this System") — this doesn't invent its own phrasing
// for that part.
export function confirmDelete({ label }) {
  return window.confirm(`Delete ${label}? This can't be undone.`);
}

// Fetch-once-per-id-set, re-render-once-resolved ownership catalog for
// character-linked map markers — shared by the Dashboard's own map.js and
// Orrery's app.js, which used to each carry an independent copy of this
// exact "prime on every render pass, re-render once the fetch resolves"
// shape. Confirmed real bug this fixes, present identically in BOTH copies:
// the re-render triggered once a fetch resolved (needed, so newly-known
// ownership actually takes effect — e.g. a marker becoming draggable) itself
// called back into the SAME priming function, and since neither copy
// tracked which id set it had already fetched, that immediately re-issued
// the identical request — an unconditional infinite loop, bounded only by
// network round-trip time (a live GET /list/character firing several times
// a second on a local server, and starving the same page's other
// in-flight work — live-stream delivery, other polls — of main-thread time
// in the process). Only re-fetches when the actual SET of character ids
// changes (a marker added/removed) — ownership/permissions themselves
// aren't expected to change from render to render, and each caller's own
// periodic full-map poll already re-renders (and so re-primes) on its own
// cadence regardless.
export function createCharacterOwnershipPrimer(dataManager) {
  let catalog = new Map();
  let pending = null;
  let lastKey = null;

  // `onResolved()` fires once, only after a genuinely NEW id set finishes
  // fetching — never synchronously, so this is always safe to call from
  // inside a render pass itself.
  function prime(ids, onResolved) {
    if (pending) return;
    const idList = Array.from(new Set(Array.from(ids || []).filter(Boolean)));
    if (!idList.length) return;
    const key = idList.slice().sort().join(",");
    if (key === lastKey) return;
    pending = refreshOwnershipCatalog(dataManager, "character", idList)
      .then((next) => {
        catalog = next;
        lastKey = key;
        pending = null;
        onResolved?.();
      })
      .catch(() => {
        pending = null;
      });
  }

  function getCatalog() {
    return catalog;
  }

  return { prime, getCatalog };
}

export async function refreshOwnershipCatalog(dataManager, kind, ids) {
  const catalog = new Map();
  if (!dataManager || !ids?.length) return catalog;
  const idSet = new Set(ids);
  try {
    const listing = await dataManager.list(kind, { refresh: true });
    const remoteEntries = dataManager.collectListEntries(listing.remote, ["owned", "shared", "public", "items"]);
    remoteEntries.forEach((entry) => {
      if (!idSet.has(entry.id)) return;
      catalog.set(entry.id, {
        ownerId: entry.owner_id ?? entry.ownerId ?? null,
        ownerUsername: entry.owner_username || entry.ownerUsername || "",
        permissions: typeof entry.permissions === "string" ? entry.permissions.toLowerCase() : "",
      });
    });
    (listing.local || []).forEach((entry) => {
      if (!idSet.has(entry.id) || catalog.has(entry.id)) return;
      catalog.set(entry.id, { ownership: "local" });
    });
  } catch (error) {
    // leave catalog empty — callers gate defensively on missing entries
  }
  return catalog;
}
