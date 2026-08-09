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
// Cross-tool import into common/ from a specific tool's own js/lib — same
// established pattern calculator.js already uses pulling from
// repository/js/lib (renderMarkdown et al.), just the other tool this time.
// Reused so a new vector layer created here (findOrCreateVectorLayer) has
// the exact same shape Orrery's own "New Layer" button produces, not a
// hand-rolled second copy.
import { createLayer } from "../../../orrery/js/lib/map-model.js";

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
    return { refresh() {}, stop() {}, noteLocalWrite() {} };
  }
  let destroyed = false;
  let loadPromise = null;
  // Bumped by the caller (noteLocalWrite, below) every time IT saves a local
  // change (a marker move, a player's drawing, ...) — doLoad captures this
  // count before its own GET goes out, and discards the response if it's
  // gone stale by the time the response comes back. Confirmed real bug this
  // fixes: a poll/live-stream fetch already in flight when a local write
  // completes has no way to know it's about to return data older than what
  // the caller just saved — applying it anyway silently reverted the local
  // write on screen (it "didn't seem to save," or a just-cleared layer's old
  // contents reappeared) until the NEXT poll tick happened to land after the
  // write instead of racing it.
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
  const liveStream = connectLiveStream({ dataManager, groupId, kinds: ["map", "ping"], shareToken });
  liveStream.subscribe("map", () => void load());
  if (typeof onPing === "function") {
    liveStream.subscribe("ping", (payload) => onPing({ position: payload.position, by: payload.by }));
  }

  return {
    refresh: () => void load(),
    // Call this right after applying the result of your OWN save locally
    // (persistMarkerMove/persistElementUpdate/persistPlayerDrawing/an
    // explicit Save — anything that just wrote a fresher copy than any
    // in-flight fetch could possibly have seen).
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

// Read-modify-write against the *latest persisted* copy of a map (not a
// stale in-memory one) — another viewer/editor could have changed the map
// in the moments since it was last fetched, and a full-object save built
// from a stale copy would silently clobber that. Same reasoning as
// combat-tracker.js's own writeThroughToCharacter.
//
// `patch` is either a plain object (shallow-merged onto the fresh element)
// or a function `(freshElement) => void` (mutated in place) — the function
// form exists for a toggle like a door's own doorState, which has to read
// the CURRENT persisted value to flip correctly, not a possibly-stale local
// copy (persistMarkerMove below always knows its own next value outright,
// so it only ever needs the plain-object form).
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

// Same fetch-fresh/mutate/save shape as persistElementUpdate above, just for
// adding a brand-new element to a layer instead of patching an existing
// one's fields — used by a restricted viewer's own Draw/Shape tools, which
// (unlike a GM in Orrery) never have a local `state.map`/Save-button flow to
// fall back on.
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

// Just an ordinary vector layer, the same shape Orrery's own "Add vector
// layer" button produces (createLayer) — a player's Draw/Shape tool needs
// SOME vector layer to land on, and (unlike Orrery's own GM tools, see
// ensureDrawableVectorLayer in orrery/js/app.js) has no selection concept
// to resolve one from. Matched by NAME specifically ("Player Drawings"),
// not "any vector layer" — the GM's own Draw/Wall/Light tools auto-create
// their own default-named "Vector Layer" the same way, and matching on
// type alone would silently dump a player's drawing into whichever one of
// those happened to exist first instead of its own layer, keeping THAT
// stale name forever. Still deliberately NOT a dedicated/reserved layer —
// no properties flag, no special "Clear Player Drawings" action, just an
// ordinary name a GM could equally have typed themselves; if a GM renames
// or deletes it, the next player drawing just creates a fresh one under the
// same name again. Operates on an ALREADY-FETCHED fresh map (mutates it in
// place and returns the layer) so persistPlayerDrawing below can
// resolve-or-create and push in one fetch/save round-trip rather than two.
function findOrCreateVectorLayer(freshMap) {
  freshMap.layers = Array.isArray(freshMap.layers) ? freshMap.layers : [];
  const existing = freshMap.layers.find((layer) => layer?.type === "vector" && layer?.name === "Player Drawings");
  if (existing) return existing;
  const layer = createLayer({ type: "vector", name: "Player Drawings" });
  freshMap.layers.push(layer);
  return layer;
}

// What a restricted viewer's Draw/Shape tools actually call — callers never
// need to know or track the target layer's id themselves, it's resolved
// (or created, the first time anyone draws on this map) fresh on every
// call, same read-modify-write safety persistElementUpdate/persistNewElement
// already rely on.
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
