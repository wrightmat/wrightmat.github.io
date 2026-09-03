// Watches a campaign group's log for the CURRENT set of active spotlights —
// "what's shown to the table right now," kept live. Hands the caller the
// complete, freshly-resolved active set on every poll rather than a
// diff-since-last-seen, so it can report an un-spotlight (not just new
// items) and the caller (dashboard.js) does its own "what changed" compare.
import { connectLiveStream } from "./live.js";
import { resolveActiveSpotlights } from "./spotlight.js";
import { createReliableInterval } from "./reliable-interval.js";

// Uses createReliableInterval since a plain setInterval throttles in a
// backgrounded/unfocused tab; a live-stream nudge below wakes it sooner.
const POLL_INTERVAL_MS = 5000;

// watchActiveSpotlights({dataManager, groupId, shareToken, pollIntervalMs, onChange})
// `onChange(activeEntries)` fires immediately on mount and on every poll/
// live-stream nudge after, with the FULL current active set — unfiltered
// by author, since this is a status display, not an accept/dismiss prompt.
export function watchActiveSpotlights({
  dataManager,
  groupId = "",
  shareToken = "",
  pollIntervalMs = POLL_INTERVAL_MS,
  onChange,
} = {}) {
  if (!dataManager || (!groupId && !shareToken) || typeof onChange !== "function") {
    return { destroy() {} };
  }
  let destroyed = false;

  async function refresh() {
    if (destroyed) return;
    try {
      const active = await resolveActiveSpotlights(dataManager, { groupId, shareToken });
      if (!destroyed) onChange(active);
    } catch (error) {
      // Transient fetch failure — try again next tick rather than tearing down.
    }
  }

  void refresh();
  const pollTimer = createReliableInterval(() => void refresh(), pollIntervalMs);

  const liveStream = connectLiveStream({ dataManager, groupId, kinds: ["group_log"], shareToken });
  liveStream.subscribe("group_log", () => void refresh());

  return {
    // Lets a caller that already knows a change happened (e.g. dashboard.js's
    // own spotlightToGroup/clearSpotlight) force an immediate re-fetch.
    refresh: () => void refresh(),
    destroy() {
      destroyed = true;
      pollTimer.stop();
      liveStream.close();
    },
  };
}
