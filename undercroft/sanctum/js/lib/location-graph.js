// Sanctum's Location Graph — a simple relationship diagram (parentId
// containment + connectedTo peer links). Shows every Location in the
// current Setting when nothing is selected (a browsing/overview tool); once
// a Location is loaded in the editor, narrows to just that Location's own
// direct relations (see computeVisibleNodes) rather than staying a
// whole-Setting view the rest of the time. This is NOT a spatial/precision
// map (that's Orrery's job, and it has zero connection to the `location`
// kind) — node positions carry no meaning beyond "roughly near its related
// neighbors."
//
// This is a thin data adapter over common/js/lib/graph-view.js's own
// generic force-directed engine (the layout/render/pan-zoom machinery
// originally lived here, extracted once Repository's own Relationships
// view needed the identical engine over a completely different kind of
// node/edge data — see that file's own header comment). Everything in
// THIS file is Location-specific: turning parentId/connectedTo into a
// generic {nodes, edges} shape, and the "narrow to the selected Location's
// own neighborhood" behavior (computeVisibleNodes), which graph-view.js
// has no reason to know anything about.
import { createForceGraph } from "../../../common/js/lib/graph-view.js";

// A location's own parentId, resolved against this Setting's actual node
// set — null for a true root, a self-reference, OR a dangling reference to
// a location outside this Setting (a stale/cross-Setting id). Every one of
// those cases is treated identically: this node becomes its own root
// rather than the layout crashing or silently dropping it.
function resolveParentId(node, idSet) {
  if (!node.parentId || node.parentId === node.id) return null;
  return idSet.has(node.parentId) ? node.parentId : null;
}

// Every parentId edge, plus every connectedTo edge deduped bidirectionally
// (A→B and B→A collapse to one edge — connectedTo is checked both ways
// everywhere else in Sanctum, same convention here). parentId and
// connectedTo are tagged by `type` for rendering only (graph-view.js's own
// physics treats every edge identically); buildEdges runs on every refresh
// regardless of whether the node SET changed, so a Relationship edit
// between two already-listed Locations always draws correctly even when it
// doesn't trigger a re-layout (graph-view.js's own setGraph skips that
// itself when the node-id set is unchanged).
function buildEdges(nodes, idSet) {
  const seen = new Set();
  const edges = [];
  nodes.forEach((node) => {
    const parentId = resolveParentId(node, idSet);
    if (parentId) edges.push({ a: parentId, b: node.id, type: "parent" });
    (Array.isArray(node.connectedTo) ? node.connectedTo : []).forEach((otherId) => {
      if (!idSet.has(otherId) || otherId === node.id) return;
      const key = [node.id, otherId].sort().join("|");
      if (seen.has(key)) return;
      seen.add(key);
      edges.push({ a: node.id, b: otherId, type: "connection" });
    });
  });
  return edges;
}

// location-type's own `scale` field (1 or 2 today, see
// common/data/location-type/*.json) drives node size — an existing,
// non-hardcoded signal for "how physically broad is this place" rather
// than a new per-type table invented here.
function radiusForScale(scale) {
  return scale === 2 ? 26 : 16;
}

// Nothing selected → the whole Setting (a browsing/overview tool). A real
// selection narrows the view to just that Location's own direct relations —
// its resolved parent, its children, and its connectedTo peers (checked
// bidirectionally, same convention as everywhere else these are read) —
// mirroring exactly what the Relationships card itself shows for the
// selected Location, not a multi-hop subgraph. Falls back to the full list
// if the selected id isn't actually in this Setting (shouldn't happen in
// practice, but stays correct rather than rendering nothing).
function computeVisibleNodes(allLocations, selectedId) {
  if (!selectedId) return allLocations;
  const byId = new Map(allLocations.map((location) => [location.id, location]));
  const selected = byId.get(selectedId);
  if (!selected) return allLocations;

  const idSet = new Set(allLocations.map((location) => location.id));
  const visibleIds = new Set([selectedId]);
  const parentId = resolveParentId(selected, idSet);
  if (parentId) visibleIds.add(parentId);
  allLocations.forEach((location) => {
    if (location.parentId === selectedId) visibleIds.add(location.id);
  });
  (Array.isArray(selected.connectedTo) ? selected.connectedTo : []).forEach((id) => {
    if (idSet.has(id)) visibleIds.add(id);
  });
  allLocations.forEach((location) => {
    if (Array.isArray(location.connectedTo) && location.connectedTo.includes(selectedId)) visibleIds.add(location.id);
  });

  return allLocations.filter((location) => visibleIds.has(location.id));
}

// `container`/`content`/`svg` — the pan-zoom stage trio (see
// common/js/lib/pan-zoom.js's own header comment for the CSS this
// requires: `content` positioned `left:50%; top:50%;` inside `container`).
// `emptyMount` — a sibling slot shown instead of `container` when the
// Setting has zero Locations. `onSelect(id)` — called on node click/Enter,
// wired by app.js to the same selectLocation(id) the Location dropdown's
// own change handler uses, so a graph click is indistinguishable from
// picking that Location from the dropdown. `getLocationTypeScale(typeId)`
// — looks up a location-type's own `scale` field for node sizing.
export function createLocationGraph({ container, content, svg, emptyMount, onSelect, getLocationTypeScale }) {
  if (!container || !content || !svg) {
    return { setLocations() {}, setSelected() {}, zoomBy() {}, reset() {}, destroy() {} };
  }

  const graph = createForceGraph({
    container,
    content,
    svg,
    emptyMount,
    onSelect,
    getNodeRadius: (node) => radiusForScale(typeof getLocationTypeScale === "function" ? getLocationTypeScale(node.typeId) : null),
    resolveParent: (node, idSet) => resolveParentId(node, idSet),
    classPrefix: "sanctum-graph",
    emptyIcon: "tabler:map-off",
    emptyMessage: "No Locations to graph yet — pick a Setting, or add some Locations to it.",
  });

  let allLocations = [];
  let selectedId = null;

  // Re-derives what's actually visible (the whole Setting, or the selected
  // Location's own neighborhood — see computeVisibleNodes) and hands the
  // result to graph-view.js's own setGraph, which only re-seeds/
  // re-simulates when the visible node-id SET itself actually changed —
  // moving the selection between two Locations is a real set change
  // (different neighborhood) so it DOES re-layout, same as a Location
  // being created/deleted; a Relationship edit between two already-visible
  // Locations, or an unrelated field edit, redraws its edge/label without
  // ever repositioning anything.
  function refresh() {
    const visible = computeVisibleNodes(allLocations, selectedId);
    const idSet = new Set(visible.map((location) => location.id));
    graph.setGraph({
      nodes: visible.map((location) => ({ ...location, label: location.name })),
      edges: buildEdges(visible, idSet),
    });
    graph.setSelected(selectedId);
  }

  function setLocations(locations) {
    allLocations = Array.isArray(locations) ? locations : [];
    refresh();
  }

  function setSelected(id) {
    selectedId = id || null;
    refresh();
  }

  return {
    setLocations,
    setSelected,
    zoomBy: graph.zoomBy,
    reset: graph.reset,
    destroy: graph.destroy,
  };
}
