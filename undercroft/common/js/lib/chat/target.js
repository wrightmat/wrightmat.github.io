// Which thread rolls and other system messages land in: the "active thread",
// shared across tools in this browser like the active group. Falls back to
// the group's default thread, which is also what opens first.

export function formatThreadLabel(channelName, threadTitle) {
  return `${channelName} › ${threadTitle}`;
}

export function findThread(overview, threadId) {
  for (const channel of overview?.channels || []) {
    const thread = (channel.threads || []).find((entry) => entry.id === threadId);
    if (thread) return { channel, thread };
  }
  return null;
}

// The visibility choices a dice or deck widget offers: Private is always there; posting to the thread needs a signed-in
// member of an active group, and Broadcast needs the GM of it.
export function visibilityOptions(dataManager, groupContext, { defaultIcon, recordTooltip, broadcastTooltip, privateTooltip }) {
  const options = [];
  if (dataManager?.isAuthenticated?.() && groupContext?.groupId) {
    options.push({ value: "default", label: "Post to thread", icon: defaultIcon, tooltip: recordTooltip });
    if (groupContext.access === "owner") {
      options.push({ value: "broadcast", label: "Broadcast", icon: "tabler:broadcast", tooltip: broadcastTooltip });
    }
  }
  options.push({ value: "private", label: "Private", icon: "tabler:eye-off", tooltip: privateTooltip });
  return options;
}

// Synchronous wording for a dice/deck interface's "where will this go" line.
// Empty when there is no active group (nothing can be posted anywhere).
export function describePostTarget(dataManager) {
  if (!dataManager?.getActiveGroup?.()) return "";
  const thread = dataManager.getActiveThread();
  return thread?.label ? `Post to ${thread.label}` : "Post to the default thread";
}

export async function resolveActiveThread(dataManager, groupId, shareToken = "") {
  if (!groupId) return null;
  const active = dataManager.getActiveThread();
  if (active && active.groupId === groupId) return active;
  const overview = await dataManager.getChatOverview({ groupId, shareToken });
  const found = findThread(overview, overview.defaultThreadId);
  if (!found) return null;
  return dataManager.setActiveThread(groupId, found.thread.id, formatThreadLabel(found.channel.name, found.thread.title));
}

// Posts into the active thread (or the default one). An archived active thread
// is dropped and the post retried once against the default.
export async function postToActiveThread(dataManager, { groupId, shareToken = "", body = "", payload, voice, refs } = {}) {
  const attempt = async () => {
    const target = await resolveActiveThread(dataManager, groupId, shareToken);
    if (!target) throw new Error("There is no thread to post to.");
    return dataManager.postChatMessage({ groupId, shareToken, threadId: target.threadId, body, payload, voice, refs });
  };
  try {
    return await attempt();
  } catch (error) {
    if (!/archived/i.test(error?.message || "")) throw error;
    dataManager.setActiveThread(null, null);
    return attempt();
  }
}

// A rolled/drawn/bought result as a system message: `kind` names what it is,
// `summary` is the one-line text shown (and archived), `details` rides along
// for richer rendering.
export function postSystemMessage(dataManager, { groupId, shareToken = "", kind, summary, details = {}, voice } = {}) {
  return postToActiveThread(dataManager, { groupId, shareToken, payload: { ...details, kind, summary }, voice });
}
