// Shared "which campaign group am I looking at" resolution for Dashboard
// widgets (Game Log, Now Showing, Combat Tracker's player mode) — mirrors
// workbench-character-view.js's syncGameLogContext priority order exactly
// (share token > the signed-in user's own active-group selection, i.e. the
// header's Campaign dropdown), just centralized once here instead of
// duplicated per widget, since the Dashboard hosts several widgets that all
// need the same answer.
//
// Deliberately does NOT fall back to a pinned/loaded character's own
// campaign membership — that used to silently override the active-group
// selection (confirmed real bug: the header could show "no campaign
// selected" while the Dashboard was actually showing another campaign's
// spotlights, because a character pinned to it belonged to that campaign;
// picking a DIFFERENT campaign from the header then did nothing, since the
// character-derived answer always won). Per the user's own call, the header
// selector must be the single source of truth for "which table am I
// watching" — a character's group membership only determines whether that
// campaign is a legal choice there at all (listGroups' own member scope,
// see auth-ui.js/groups.py), never an automatic, silent substitute for
// actually choosing it. This also directly enables "opt in and out" and
// "which of several campaigns, across several owned characters, am I
// currently at" — neither is expressible if a pinned character's own
// membership always wins.
export async function resolveGroupContext(dataManager, { shareToken = "" } = {}) {
  if (shareToken) {
    try {
      const shared = await dataManager.fetchGroupShare(shareToken);
      const group = shared?.group;
      if (group?.id) {
        return {
          groupId: group.id,
          groupName: group.name || "",
          systemId: group.system_id || "",
          settingId: group.setting_id || "",
          shareToken,
          access: dataManager.isAuthenticated() ? "share" : "viewer",
        };
      }
    } catch (error) {
      return null;
    }
    return null;
  }

  if (!dataManager.isAuthenticated()) {
    return null;
  }

  const active = dataManager.getActiveGroup();
  if (active?.groupId) {
    // getActiveGroup() only ever returns whatever {groupId, name} was
    // cached when the user picked it (auth-ui.js's own campaign selector)
    // — no owner_id, so "access" can't be inferred from this alone.
    // Assuming "owner" unconditionally used to be safe here, back when a
    // group you don't own could never even be SELECTED as your active
    // group at all — now that listGroups' own member scope (see
    // data-manager.js) lets a mere MEMBER select a campaign they don't
    // own too (added to it via a character they own, not something they
    // created), that assumption is wrong: confirmed real bug, a
    // player-tier member who selected a campaign they were added to (not
    // one they own) got reported as "owner," exposing GM-only controls
    // (a Map widget's own show/hide toggle) to them client-side — the
    // server's own separate authorization still correctly rejected the
    // actual action, but the button itself shouldn't have shown at all.
    try {
      const { groups } = await dataManager.listGroups({ includeMemberGroups: true });
      const match = Array.isArray(groups) ? groups.find((entry) => entry.id === active.groupId) : null;
      if (match) {
        const ownerId = match.owner_id ?? null;
        const userId = dataManager.session?.user?.id ?? null;
        return {
          groupId: active.groupId,
          groupName: match.name || active.name || "",
          systemId: match.system_id || "",
          settingId: match.setting_id || "",
          shareToken: "",
          access: ownerId === userId ? "owner" : "member",
        };
      }
    } catch (error) {
      // Falls through to the unconditional-owner shape below as a last
      // resort, matching the pre-existing behavior, rather than breaking
      // group access entirely over a failed lookup.
    }
    return { groupId: active.groupId, groupName: active.name || "", systemId: "", settingId: "", shareToken: "", access: "owner" };
  }
  return null;
}

// Auto-default helper for the generator tools (Forge/Crucible/Vault/
// Sanctum) — "if a campaign group is active and assigned to a System/
// Setting, default these tools' own pickers to it, to make mid-campaign
// generation faster" (explicit user ask). `groupContext` is whatever
// resolveGroupContext above returned (or null); `key` is "systemId" or
// "settingId"; `options` is the tool's own already-loaded list for that
// picker (needs an `id` on each entry). Returns "" (never a value the
// picker can't actually offer) when there's no active group, the group
// never had that field assigned, or it points at a System/Setting this
// tool's own list doesn't currently contain (deleted, or not visible to
// this user) — the caller's existing "nothing chosen yet" placeholder
// behavior is always a safe fallback.
export function pickGroupDefaultId(groupContext, key, options) {
  const id = groupContext?.[key];
  if (!id || !Array.isArray(options)) return "";
  return options.some((entry) => entry.id === id) ? id : "";
}
