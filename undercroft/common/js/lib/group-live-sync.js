// Shared "watch a saved Group record for remote changes, and safely write
// one Property value" mechanism — mirrors common/js/lib/map-live-sync.js's
// exact watch/write shape for a Map, just for a Group's own document
// instead (a Group is a generic Library kind now too — see
// server/storage.py's _migrate_groups_to_library_items). Per the "check for
// existing transport before inventing a new mechanism" principle, this is a
// poll (createReliableInterval) plus an optional live-stream wake-up
// (connectLiveStream's "group" kind) — no new server infrastructure beyond
// the one new kind already added to live.js's own ALL_KINDS.
import { connectLiveStream } from "./live.js";
import { createReliableInterval } from "./reliable-interval.js";

export function watchGroupForChanges({
  dataManager,
  groupId,
  shareToken = "",
  pollIntervalMs = 20000,
  onChange,
  onError,
} = {}) {
  if (!dataManager || !groupId) {
    return { refresh() {}, stop() {}, noteLocalWrite() {} };
  }
  let destroyed = false;
  let loadPromise = null;
  // Same staleness guard as watchMapForChanges's own localWriteSeq — a
  // poll/live-stream fetch already in flight when a property value write
  // completes has no way to know it's about to return data older than what
  // was just saved, and would otherwise silently revert it on screen until
  // the next tick happens to land after the write instead of racing it.
  let localWriteSeq = 0;

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
      // preferLocal: false — the whole point is picking up a change someone
      // ELSE made (the GM, or another party member); a locally cached copy
      // would defeat that.
      const result = await dataManager.get("group", groupId, { shareToken, preferLocal: false });
      if (destroyed) return;
      if (seqAtStart !== localWriteSeq) return; // stale — see localWriteSeq's own comment
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

// Writes ONE Group Property value through the server's own narrow,
// per-property-permission endpoint (server/groups.py's
// update_group_property_value) — deliberately NOT a client-side
// fetch-fresh/mutate/save cycle the way map-live-sync.js's
// persistElementUpdate is, since a plain party member generally has no
// owner/edit-share access to the group's own document at all (unlike every
// campaign member already holding an edit share on a spotlighted Map). The
// server does its own fetch-fresh/mutate/save internally, gated by that one
// property's own `public` flag instead of blanket document-edit access.
// Returns the group's full, current propertyValues object.
export async function persistGroupPropertyValue({ dataManager, groupId, key, value }) {
  const result = await dataManager.updateGroupPropertyValue({ id: groupId, key, value });
  return result?.propertyValues;
}
