// Shared "watch a saved Map record for remote changes" mechanism — extracted
// from the Dashboard's read-only Map widget (widgets/map.js) so Orrery's own
// authoring surface can pick up the exact same live-following behavior (a
// player dragging their token via the widget, a GM editing the same map from
// another tab/device) without a second, drifting copy of this logic. Per the
// "check for existing transport before inventing a new mechanism" principle,
// this is a poll (createReliableInterval) plus an optional live-stream
// wake-up (connectLiveStream's "map" kind) — no new server infrastructure.
//
// connectLiveStream requires a real campaign `groupId` to do anything (it's
// a no-op otherwise, see live.js) — Dashboard widgets always have one (their
// whole context is a specific group's shared board), but Orrery's own
// standalone editing surface currently has no group association for a map
// at all (Maps are owned by an account, not scoped to a group, in the
// Library data model). Callers without a groupId still get the plain poll,
// which needs nothing else to work — the live-stream half is just a "wake
// sooner" optimization on top, always safe to omit.
import { connectLiveStream } from "./live.js";
import { createReliableInterval } from "./reliable-interval.js";

// `onPing`, if supplied, also subscribes to the same pooled live-stream
// connection's "ping" kind (Orrery's click-to-ping tool) — a transient,
// never-persisted broadcast (see server/state.py's ServerState.
// pending_pings), so unlike onChange there's nothing to poll/fetch for it:
// it only ever fires from a live-stream event, and (same as the SSE
// "wake sooner" half of onChange) needs a real `groupId` to do anything at
// all.
export function watchMapForChanges({
  dataManager,
  mapId,
  shareToken = "",
  groupId = "",
  pollIntervalMs = 10000,
  onChange,
  onError,
  onPing,
} = {}) {
  if (!dataManager || !mapId) {
    return { refresh() {}, stop() {} };
  }
  let destroyed = false;
  let loadPromise = null;

  function load() {
    if (!loadPromise) {
      loadPromise = doLoad().finally(() => {
        loadPromise = null;
      });
    }
    return loadPromise;
  }

  async function doLoad() {
    try {
      // preferLocal: false — the whole point is picking up a change someone
      // ELSE made; a locally cached copy would defeat that.
      const result = await dataManager.get("map", mapId, { shareToken, preferLocal: false });
      if (destroyed) return;
      onChange?.(result?.payload);
    } catch (error) {
      if (!destroyed) onError?.(error);
    }
  }

  // createReliableInterval only fires after its first interval elapses
  // (same as plain setInterval) — an eager call here gets the initial data
  // immediately instead of leaving the caller blank for the first
  // pollIntervalMs.
  void load();
  const pollTimer = createReliableInterval(() => void load(), pollIntervalMs);
  const liveStream = connectLiveStream({ dataManager, groupId, kinds: ["map", "ping"], shareToken });
  liveStream.subscribe("map", () => void load());
  if (typeof onPing === "function") {
    liveStream.subscribe("ping", (payload) => onPing({ position: payload.position, by: payload.by }));
  }

  return {
    refresh: () => void load(),
    stop() {
      destroyed = true;
      pollTimer.stop();
      liveStream.close();
    },
  };
}

// Read-modify-write against the *latest persisted* copy of a map (not a
// stale in-memory one) — another viewer/editor could have changed the map
// in the moments since it was last fetched, and a full-object save built
// from a stale copy would silently clobber that. Same reasoning as
// combat-tracker.js's own writeThroughToCharacter.
export async function persistMarkerMove({ dataManager, mapId, shareToken = "", layerId, elementId, nextPosition }) {
  const result = await dataManager.get("map", mapId, { shareToken, preferLocal: false });
  const freshMap = result.payload;
  const freshElement = freshMap.layers
    ?.find((entry) => entry.id === layerId)
    ?.elements?.find((entry) => entry.id === elementId);
  if (!freshElement) return null;
  freshElement.position = nextPosition;
  await dataManager.save("map", mapId, freshMap);
  return freshMap;
}
