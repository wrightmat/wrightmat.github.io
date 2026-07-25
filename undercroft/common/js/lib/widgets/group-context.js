// Shared "which campaign group am I looking at" resolution for Dashboard
// widgets (Game Log, Now Showing, Combat Tracker's player mode) — mirrors
// workbench-character-view.js's syncGameLogContext priority order exactly
// (share token > the pinned character's own campaign membership > the
// signed-in owner's active-group selection), just centralized once here
// instead of duplicated per widget, since the Dashboard hosts several
// widgets that all need the same answer.
export async function resolveGroupContext(dataManager, { pinnedCharacterId = "", shareToken = "" } = {}) {
  if (shareToken) {
    try {
      const shared = await dataManager.fetchGroupShare(shareToken);
      const group = shared?.group;
      if (group?.id) {
        return {
          groupId: group.id,
          groupName: group.name || "",
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

  if (pinnedCharacterId) {
    try {
      const payload = await dataManager.listCharacterGroups(pinnedCharacterId);
      const groups = Array.isArray(payload?.groups) ? payload.groups : [];
      const campaign =
        groups.find((entry) => typeof entry?.type === "string" && entry.type.toLowerCase() === "campaign") ||
        groups[0] ||
        null;
      if (campaign) {
        const ownerId = campaign.owner_id ?? null;
        const userId = dataManager.session?.user?.id ?? null;
        return {
          groupId: campaign.id,
          groupName: campaign.name || "",
          shareToken: "",
          access: ownerId === userId ? "owner" : "member",
        };
      }
    } catch (error) {
      // Fall through to the active-group selector below.
    }
  }

  const active = dataManager.getActiveGroup();
  if (active?.groupId) {
    return { groupId: active.groupId, groupName: active.name || "", shareToken: "", access: "owner" };
  }
  return null;
}
