// Watches a campaign group's log for the CURRENT set of active spotlights —
// "what's shown to the table right now," kept live. Replaces this file's own
// former watchSpotlight (a one-at-a-time, persisted-seen-id watcher built to
// drive a push-notification toast) — retired along with that toast
// (widgets/spotlight-prompt.js, deleted) in favor of a persistent status
// panel (widgets/spotlight-panel.js) that needs full current truth, not a
// diff-since-last-seen. That old design structurally couldn't report
// something being un-spotlighted at all (it only ever reported NEW items);
// this one doesn't have that gap, because it doesn't try to diff anything
// itself — it just hands the caller the complete, freshly-resolved active
// set on every poll and lets the caller (dashboard.js) do its own "what
// changed" comparison against whatever it's showing.
import { connectLiveStream } from "./live.js";
import { resolveActiveSpotlights } from "./spotlight.js";
import { createReliableInterval } from "./reliable-interval.js";

// 5s, plus a live-stream "wake sooner" nudge below — same cadence/mechanism
// combat-tracker.js and the old watchSpotlight already established for this
// exact class of problem (plain window.setInterval gets throttled in a
// backgrounded/unfocused tab).
const POLL_INTERVAL_MS = 5000;

// watchActiveSpotlights({dataManager, groupId, shareToken, pollIntervalMs, onChange})
// `onChange(activeEntries)` fires once immediately (on mount) and again on
// every poll tick/live-stream nudge thereafter, always with the FULL current
// active set (resolveActiveSpotlights' own return shape — raw log entries,
// author included) — never filtered by author. This is a status display,
// not an accept-or-dismiss prompt, so the caller seeing its own actions
// reflected here too is correct, not noise.
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
      // Try again next tick — a transient fetch failure shouldn't tear this
      // down, same as every other poller in this codebase.
    }
  }

  void refresh();
  const pollTimer = createReliableInterval(() => void refresh(), pollIntervalMs);

  // Wakes the poll up sooner on a relevant change — see live.js's own
  // comment; polling above keeps running unchanged either way.
  const liveStream = connectLiveStream({ dataManager, groupId, kinds: ["group_log"], shareToken });
  liveStream.subscribe("group_log", () => void refresh());

  return {
    // Exposed so a caller that already knows a change just happened (e.g.
    // dashboard.js reacting to its own dataManager.spotlightToGroup/
    // clearSpotlight call) can force an immediate re-fetch instead of
    // waiting for the next poll tick or a live-stream round-trip.
    refresh: () => void refresh(),
    destroy() {
      destroyed = true;
      pollTimer.stop();
      liveStream.close();
    },
  };
}
