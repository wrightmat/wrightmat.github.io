// Watches a saved Group record for remote changes and safely writes one
// Property value — mirrors map-live-sync.js's watch/write shape for a Group's
// document instead of a Map's. Poll (createReliableInterval) plus an
// optional live-stream wake-up (connectLiveStream's "group" kind).
import { connectLiveStream } from "./live.js";
import { createReliableInterval } from "./reliable-interval.js";

export function watchGroupForChanges({
  dataManager,
  groupId,
  shareToken = "",
  // Whether this viewer owns/admins the group — caller resolves this up
  // front (via listGroups, never 401s) so the route is decided in advance
  // rather than optimistically trying the owner-only route and catching a
  // failure that was always going to happen, which would just add console
  // noise a real bug should stand out against.
  isOwner = false,
  pollIntervalMs = 20000,
  onChange,
  onError,
} = {}) {
  if (!dataManager || !groupId) {
    return { refresh() {}, stop() {}, noteLocalWrite() {} };
  }
  let destroyed = false;
  let loadPromise = null;
  // Staleness guard (same pattern as watchMapForChanges): an in-flight
  // poll/live-stream fetch has no way to know it's about to return data
  // older than a write that just completed, and would silently revert it.
  let localWriteSeq = 0;
  // The generic /content/group/{id} route only grants a non-owner reader via
  // a share token or Character-linked share — a plain member with neither
  // always 401s there. Resolved once up front since access doesn't change
  // mid-session.
  const useFullRoute = isOwner || Boolean(shareToken);

  function load() {
    if (!loadPromise) {
      loadPromise = doLoad().finally(() => {
        loadPromise = null;
      });
    }
    return loadPromise;
  }

  async function doLoad() {
    const seqAtStart = localWriteSeq;
    try {
      // preferLocal: false — the point is picking up a change someone ELSE
      // made; a locally cached copy would defeat that.
      let payload;
      if (useFullRoute) {
        const result = await dataManager.get("group", groupId, { shareToken, preferLocal: false });
        payload = result?.payload;
      } else {
        // Dedicated, member-aware read (public-only for a non-owner).
        const result = await dataManager.getGroupProperties(groupId);
        payload = { properties: result.properties, propertyValues: result.propertyValues };
      }
      if (destroyed) return;
      if (seqAtStart !== localWriteSeq) return; // stale — see localWriteSeq's own comment
      onChange?.(payload);
    } catch (error) {
      if (!destroyed) onError?.(error);
    }
  }

  // createReliableInterval only fires after its first interval elapses (like
  // setInterval) — this eager call gets initial data immediately instead.
  void load();
  const pollTimer = createReliableInterval(() => void load(), pollIntervalMs);
  const liveStream = connectLiveStream({ dataManager, groupId, kinds: ["group"], shareToken });
  liveStream.subscribe("group", () => void load());

  return {
    refresh: () => void load(),
    // Call this right after applying the result of your OWN
    // persistGroupPropertyValue call below.
    noteLocalWrite() {
      localWriteSeq += 1;
    },
    stop() {
      destroyed = true;
      pollTimer.stop();
      liveStream.close();
    },
  };
}

// Writes ONE Group Property through the server's narrow per-property
// endpoint rather than a client-side fetch/mutate/save cycle (map-live-
// sync.js's persistElementUpdate) — a plain party member generally has no
// document-edit access to the group at all, so the server does its own
// fetch/mutate/save internally, gated by that property's own `public` flag.
// Returns the group's full, current propertyValues object.
export async function persistGroupPropertyValue({ dataManager, groupId, key, value }) {
  const result = await dataManager.updateGroupPropertyValue({ id: groupId, key, value });
  return result?.propertyValues;
}
