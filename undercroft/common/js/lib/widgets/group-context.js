// Shared "which player group am I looking at" resolution for Dashboard
// widgets (Game Log, Now Showing, Combat Tracker's player mode) — mirrors
// workbench-character-view.js's syncGameLogContext priority order exactly
// (share token > the header's Group dropdown selection), centralized once
// here since several Dashboard widgets need the same answer.
//
// Deliberately does NOT fall back to a pinned/loaded character's own group
// membership — that used to silently override the active-group selection
// (the header could show "no campaign selected" while the Dashboard actually
// showed another group's spotlights, and picking a different group
// from the header did nothing). The header selector is the single source of
// truth for "which table am I watching" — a character's membership only
// determines whether that group is a legal choice there at all, never an
// automatic substitute for choosing it.
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
          // `?? null`, not `|| ""` — 0 is a real, meaningful day index (the
          // group's own start epoch), not an absent value the way an
          // empty string id would be.
          groupDayIndex: group.group_day_index ?? null,
          groupMinutesOfDay: group.group_minutes_of_day ?? null,
          shareToken,
          access: dataManager.isAuthenticated() ? "share" : "viewer",
          // Game Log's @mention roster (character label + owner_id per
          // member) — _serialize_group (server/groups.py) already attaches
          // this to a share payload same as an owned/member group's own
          // listGroups entry does below; kept here rather than re-fetched
          // separately.
          members: Array.isArray(group.members) ? group.members : [],
          ownerId: group.owner_id ?? null,
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
    // getActiveGroup() only returns the cached {groupId, name} the user
    // picked — no owner_id, so "access" can't be inferred from this alone.
    // Assuming "owner" unconditionally was safe back when a group you don't
    // own could never be selected as active at all; now that a mere member
    // can select a group they don't own (listGroups' member scope), that
    // assumption wrongly exposed GM-only controls (e.g. Map's show/hide
    // toggle) client-side to a non-owner member — the server's own
    // authorization still rejected the actual action, but the button
    // shouldn't have shown at all.
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
          groupDayIndex: match.group_day_index ?? null,
          groupMinutesOfDay: match.group_minutes_of_day ?? null,
          shareToken: "",
          access: ownerId === userId ? "owner" : "member",
          members: Array.isArray(match.members) ? match.members : [],
          ownerId,
        };
      }
    } catch (error) {
      // Falls through to the unconditional-owner shape below as a last
      // resort rather than breaking group access entirely.
    }
    return {
      groupId: active.groupId,
      groupName: active.name || "",
      systemId: "",
      settingId: "",
      groupDayIndex: null,
      groupMinutesOfDay: null,
      shareToken: "",
      access: "owner",
      // No roster available (the listGroups lookup failed) — the "owner"
      // assumption above is the best guess for ownerId too.
      members: [],
      ownerId: dataManager.session?.user?.id ?? null,
    };
  }
  return null;
}

// Auto-default helper for the generator tools (Forge/Crucible/Vault/
// Sanctum): if a player group is active and assigned to a System/Setting,
// default these tools' own pickers to it. `key` is "systemId" or
// "settingId"; `options` is the tool's already-loaded list for that picker.
// Returns "" whenever there's no active group, no assigned value, or the
// value points at a record this tool's list doesn't contain — the caller's
// existing "nothing chosen yet" placeholder is always a safe fallback.
export function pickGroupDefaultId(groupContext, key, options) {
  const id = groupContext?.[key];
  if (!id || !Array.isArray(options)) return "";
  return options.some((entry) => entry.id === id) ? id : "";
}

// The party roster for a "quickly add the PCs" action (Combat Tracker's own
// Add Party button, and the Start Encounter modal's "Also add the party"
// checkbox) — real, current membership via the same `/groups` listing
// resolveGroupContext above uses (`_serialize_group`'s live `members`,
// content_type/content_id/label/missing), NOT the raw `group` Library
// record's own stored JSON (dataManager.get("group", id)) — that document
// has no `members` field at all; membership lives in the separate
// group_members table and is only ever attached server-side by the
// dedicated /groups routes. `missing` filters out a roster slot whose
// character record was deleted out from under it.
export async function fetchGroupMemberCharacters(dataManager, groupId) {
  if (!groupId) return [];
  try {
    const { groups } = await dataManager.listGroups({ includeMemberGroups: true });
    const match = Array.isArray(groups) ? groups.find((entry) => entry.id === groupId) : null;
    const members = Array.isArray(match?.members) ? match.members : [];
    return members
      .filter((member) => member?.content_type === "character" && member?.content_id && !member.missing)
      .map((member) => ({ id: member.content_id, name: member.label || member.content_id }));
  } catch (error) {
    return [];
  }
}
