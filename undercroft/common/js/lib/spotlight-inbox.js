// Watches a campaign group's log for a NEW spotlight entry (something a GM
// "showed to table") and calls back once per genuinely-new one. Generalizes
// the poll-newest-first-and-dedupe logic the retired now-showing.js widget
// used to run on its own — the Dashboard now owns exactly one of these (not
// one per widget) and fans the result out to both the accept-prompt toast
// and the Game Log widget's own inline Accept button.
import { connectLiveStream } from "./live.js";

const POLL_INTERVAL_MS = 30000;

// `lastSeenId` seeds dedup from a caller-persisted id (dashboardSeenSpotlightId
// in dashboard.js) so a page reload doesn't immediately re-report whatever
// was already surfaced before the reload.
export function watchSpotlight({ dataManager, groupId = "", shareToken = "", lastSeenId = "", onNewSpotlight } = {}) {
  if (!dataManager || (!groupId && !shareToken) || typeof onNewSpotlight !== "function") {
    return { destroy() {} };
  }
  let destroyed = false;
  let pollTimer = 0;
  let seenId = lastSeenId;

  async function refresh() {
    if (destroyed) return;
    let entries;
    try {
      // types filter — see spotlight.js's own SPOTLIGHT_LOG_TYPES comment:
      // without it, this poll's own small `limit` window is just as
      // susceptible to being crowded out by ordinary chat/roll entries (or
      // a chatty inline-kind widget's own frequent spotlight-update
      // refreshes) as the bug that filter fixed there — a genuinely-new
      // "show to table" could silently never surface an accept prompt.
      // "spotlight-update" itself is deliberately excluded here (unlike
      // spotlight.js's own filter) — this poll only ever cares about a
      // brand-new spotlight or a clear, never a data refresh on one already
      // seen.
      const log = await dataManager.getGroupLog({ groupId, shareToken, limit: 20, types: ["spotlight", "spotlight-clear"] });
      entries = Array.isArray(log?.entries) ? log.entries : [];
    } catch (error) {
      return;
    }
    // The server returns entries oldest-first — sort newest-first before
    // picking "the latest spotlight or clear," so a spotlight-clear posted
    // after the last spotlight is what actually wins.
    entries.sort((a, b) => (Date.parse(b.created_at) || 0) - (Date.parse(a.created_at) || 0));
    const latest = entries.find((entry) => entry?.type === "spotlight" || entry?.type === "spotlight-clear");
    if (!latest || latest.id === seenId) return;
    seenId = latest.id;
    if (latest.type === "spotlight-clear") return;
    // Whoever posted this already has it — a GM spotlighting their own
    // encounter (or anything else) shouldn't get an "accept this" prompt for
    // their own action. Marked seen above either way, so it's never
    // re-evaluated.
    const viewerId = dataManager.session?.user?.id;
    if (viewerId && latest.author?.id === viewerId) return;
    const kind = String(latest.payload?.kind || "").trim();
    const id = String(latest.payload?.id || "").trim();
    if (!kind || !id) return;
    onNewSpotlight({
      entryId: latest.id,
      kind,
      id,
      templateId: String(latest.payload?.templateId || "").trim(),
    });
  }

  void refresh();
  pollTimer = window.setInterval(() => void refresh(), POLL_INTERVAL_MS);

  // Wakes the existing 30s poll up sooner on a relevant change — see
  // live.js's own comment; polling above keeps running unchanged either way.
  const liveStream = connectLiveStream({ dataManager, groupId, kinds: ["group_log"], shareToken });
  liveStream.subscribe("group_log", () => void refresh());

  return {
    destroy() {
      destroyed = true;
      if (pollTimer) window.clearInterval(pollTimer);
      liveStream.close();
    },
  };
}
