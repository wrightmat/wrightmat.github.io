// Shared "watch a saved Map record for remote changes" mechanism — extracted
// from the Dashboard's read-only Map widget so Orrery's own authoring
// surface can share the same live-following behavior instead of a drifting
// second copy. A poll (createReliableInterval) plus an optional live-stream
// wake-up (connectLiveStream's "map" kind) — no new server infrastructure.
//
// connectLiveStream requires a real campaign `groupId` (no-op otherwise) —
// Dashboard widgets always have one, but Orrery's standalone editing surface
// currently has no group association for a map (Maps are account-owned, not
// group-scoped). Callers without a groupId still get the plain poll; the
// live-stream half is just a "wake sooner" optimization on top.
import { connectLiveStream } from "./live.js";
import { createReliableInterval } from "./reliable-interval.js";
// Reused so a vector layer created here (findOrCreateVectorLayer) has the
// exact same shape Orrery's own "New Layer" button produces.
import { createLayer } from "../../../orrery/js/lib/map-model.js";

// `onPing`, if supplied, also subscribes to the "ping" kind (Orrery's
// click-to-ping tool) — a transient, never-persisted broadcast, so unlike
// onChange there's nothing to poll/fetch: it only fires from a live-stream
// event, and needs a real `groupId` to do anything at all.
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
    return { refresh() {}, stop() {}, noteLocalWrite() {} };
  }
  let destroyed = false;
  let loadPromise = null;
  // Bumped by the caller (noteLocalWrite, below) on every local save — doLoad
  // captures this count before its GET goes out and discards the response if
  // it's gone stale by the time it returns, so a fetch already in flight when
  // a local write completes can't silently revert that write on screen.
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
      // ELSE made; a locally cached copy would defeat that.
      const result = await dataManager.get("map", mapId, { shareToken, preferLocal: false });
      if (destroyed) return;
      if (seqAtStart !== localWriteSeq) return; // stale — see localWriteSeq above
      onChange?.(result?.payload);
    } catch (error) {
      if (!destroyed) onError?.(error);
    }
  }

  // createReliableInterval only fires after its first interval elapses; an
  // eager call here gets initial data immediately instead of a blank first
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
    // Call right after applying the result of your own save locally.
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

// Read-modify-write against the *latest persisted* copy of a map, not a
// stale in-memory one — another viewer/editor could have changed the map
// since it was last fetched, and a full-object save built from a stale copy
// would silently clobber that (same reasoning as combat-tracker.js's
// writeThroughToCharacter).
//
// `patch` is either a plain object (shallow-merged) or a function
// `(freshElement) => void` (mutated in place) — the function form exists for
// a toggle like a door's doorState, which has to read the current persisted
// value to flip correctly rather than a possibly-stale local copy.
export async function persistElementUpdate({ dataManager, mapId, shareToken = "", layerId, elementId, patch }) {
  const result = await dataManager.get("map", mapId, { shareToken, preferLocal: false });
  const freshMap = result.payload;
  const freshElement = freshMap.layers
    ?.find((entry) => entry.id === layerId)
    ?.elements?.find((entry) => entry.id === elementId);
  if (!freshElement) return null;
  if (typeof patch === "function") {
    patch(freshElement);
  } else {
    Object.assign(freshElement, patch);
  }
  await dataManager.save("map", mapId, freshMap);
  return freshMap;
}

export async function persistMarkerMove({ dataManager, mapId, shareToken = "", layerId, elementId, nextPosition }) {
  return persistElementUpdate({ dataManager, mapId, shareToken, layerId, elementId, patch: { position: nextPosition } });
}

// Same fetch-fresh/mutate/save shape as persistElementUpdate, for adding a
// new element instead of patching an existing one — used by a restricted
// viewer's Draw/Shape tools, which (unlike a GM in Orrery) have no local
// `state.map`/Save-button flow to fall back on.
export async function persistNewElement({ dataManager, mapId, shareToken = "", layerId, element }) {
  const result = await dataManager.get("map", mapId, { shareToken, preferLocal: false });
  const freshMap = result.payload;
  const layer = freshMap.layers?.find((entry) => entry.id === layerId);
  if (!layer) return null;
  layer.elements = Array.isArray(layer.elements) ? layer.elements : [];
  layer.elements.push(element);
  await dataManager.save("map", mapId, freshMap);
  return freshMap;
}

// Just an ordinary vector layer, matched by NAME ("Player Drawings") rather
// than "any vector layer" — the GM's own Draw/Wall/Light tools auto-create a
// default-named "Vector Layer" the same way, and matching on type alone
// would dump a player's drawing into whichever happened to exist first.
// Deliberately not a dedicated/reserved layer — an ordinary name a GM could
// equally have typed; if renamed or deleted, the next drawing just creates a
// fresh one. Operates on an already-fetched fresh map (mutates in place) so
// persistPlayerDrawing can resolve-or-create in one fetch/save round-trip.
function findOrCreateVectorLayer(freshMap) {
  freshMap.layers = Array.isArray(freshMap.layers) ? freshMap.layers : [];
  const existing = freshMap.layers.find((layer) => layer?.type === "vector" && layer?.name === "Player Drawings");
  if (existing) return existing;
  const layer = createLayer({ type: "vector", name: "Player Drawings" });
  freshMap.layers.push(layer);
  return layer;
}

// What a restricted viewer's Draw/Shape tools call — callers never track the
// target layer's id themselves, it's resolved (or created) fresh each call.
export async function persistPlayerDrawing({ dataManager, mapId, shareToken = "", element }) {
  const result = await dataManager.get("map", mapId, { shareToken, preferLocal: false });
  const freshMap = result.payload;
  const layer = findOrCreateVectorLayer(freshMap);
  layer.elements.push(element);
  await dataManager.save("map", mapId, freshMap);
  return freshMap;
}

// Deletes one element (a player removing their own drawing/shape) — same
// fetch-fresh/mutate/save shape as everything else in this file.
export async function removeElement({ dataManager, mapId, shareToken = "", layerId, elementId }) {
  const result = await dataManager.get("map", mapId, { shareToken, preferLocal: false });
  const freshMap = result.payload;
  const layer = freshMap.layers?.find((entry) => entry.id === layerId);
  if (!layer) return null;
  layer.elements = (layer.elements || []).filter((entry) => entry.id !== elementId);
  await dataManager.save("map", mapId, freshMap);
  return freshMap;
}
