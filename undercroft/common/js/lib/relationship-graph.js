// The suite-wide relationship graph — a `relationship` Library record IS one
// edge (`{fromKind, fromId, toKind, toId, type, label, value}`), any two
// records of any kind, `type` free text (never a hard enum: "Member of,"
// "Prey of," "Reputation with," whatever a GM types). No new schema on
// npc/monster/location/character — the kind-registry mechanism means
// dropping common/data/kind/relationship.json in was enough for the generic
// save/list/get/delete/share routes to support this immediately.
//
// Stored edges are directed (`from`→`to`) even for symmetric-reading types
// ("Allied with") — direction is kept for consistency, callers don't have to
// make a visual point of it. A record's own Relationships section shows
// edges touching it from EITHER direction (fetchEdgesTouching), which is
// also how "Organizations" fall out for free with no separate flag: an NPC
// that other NPCs point at with "Member of" edges simply shows those rows in
// its own list too, the reverse direction of the same query.
//
// Sanctum's own parentId/connectedTo are DERIVED from this kind, not a
// second parallel source of truth — "Parent of"/"Connected to" are just two
// of Sanctum's own suggested relationship types (js/app.js's own
// RELATIONSHIP_TYPE_SUGGESTIONS); applyDerivedLocationHierarchy recomputes
// the in-memory parentId/connectedTo shape from real relationship edges on
// every load, purely for dungeon-generation's own legacy consumers
// (renameChildRoomsIfConfirmed/collectDescendantLocations) that still expect
// that shape locally — nothing is persisted in that scalar form anymore. A
// caller that wants some other non-`relationship`-kind data folded into a
// graph alongside real relationship records can still pass it in as
// `extraEdges` to buildRelationshipGraph below, tagged `synthetic: true` so
// the editor UI knows not to offer removing it the generic way.
import { fetchKindEntrySummaries, loadLibraryKinds } from "./content-fetch.js";

export function randomRelationshipId() {
  if (typeof crypto !== "undefined" && typeof crypto.randomUUID === "function") {
    return crypto.randomUUID();
  }
  return `${Date.now()}-${Math.random().toString(16).slice(2)}`;
}

function nodeKey(kind, id) {
  return `${kind}:${id}`;
}

// Every saved `relationship` record, flattened to `{id, fromKind, fromId,
// toKind, toId, type, label, value}`. Fetch-everything-then-filter-client-
// side — the same pattern relationships-graph.js already uses for journal
// pages, and the right scale for this suite's own architecture (no
// server-side indexed queries anywhere else either).
//
// Deliberately NOT fetchKindEntriesWithIds (content-fetch.js) — that helper
// is remote-only (includeLocal: false), correct for shared REFERENCE data
// but wrong here: an anonymous, not-signed-in GM's own relationships are
// exactly the kind of content the suite's "local-first saving" rule says
// must keep working with no account at all (same as an anonymous NPC/
// Location save). Mirrors content-picker.js's own remote+local merge —
// remote wins on an id collision, same precedent that already establishes.
export async function fetchAllRelationships(dataManager) {
  if (!dataManager) return [];
  const { remote } = await dataManager.list("relationship", { refresh: true, includeLocal: false });
  const remoteRows = dataManager.collectListEntries(remote, ["owned", "shared", "public", "items"]);
  const remoteEntries = (
    await Promise.all(
      remoteRows.map(async (row) => {
        try {
          const result = await dataManager.get("relationship", row.id, { preferLocal: false });
          return { id: row.id, ...(result?.payload || {}) };
        } catch (error) {
          return null;
        }
      })
    )
  ).filter(Boolean);
  const remoteIds = new Set(remoteEntries.map((entry) => entry.id));
  const localEntries = (dataManager.listLocalEntries("relationship") || [])
    .filter((entry) => !remoteIds.has(entry.id))
    .map((entry) => ({ id: entry.id, ...(entry.payload || {}) }));
  return [...remoteEntries, ...localEntries];
}

// Every edge touching one specific record, either direction — the query
// every tool's own Relationships list section runs for whatever record is
// currently loaded.
export async function fetchEdgesTouching(dataManager, { kind, id } = {}) {
  if (!kind || !id) return [];
  const all = await fetchAllRelationships(dataManager);
  return all.filter(
    (edge) => (edge.fromKind === kind && edge.fromId === id) || (edge.toKind === kind && edge.toId === id)
  );
}

export async function saveRelationship(dataManager, edge) {
  const id = edge.id || randomRelationshipId();
  await dataManager.save("relationship", id, {
    fromKind: edge.fromKind,
    fromId: edge.fromId,
    toKind: edge.toKind,
    toId: edge.toId,
    type: edge.type || "",
    label: edge.label || "",
    value: edge.value || "",
  });
  return id;
}

export async function deleteRelationship(dataManager, id) {
  if (!id) return;
  await dataManager.delete("relationship", id);
}

// {kindId -> label} — cached module-wide for the session (the kind registry
// doesn't change mid-session; same "fetch once, reuse" precedent
// content-fetch.js's own loadDdbLookupTables/loadCharacterMappingDefinition
// already establish). relationship-editor.js uses this to show a
// relationship's OTHER end as its entity type ("NPC," "Location") rather
// than which tool owns it ("Forge," "Sanctum") — kindToolLabel
// (kind-tool-route.js) stays reserved for the actual "Open in <Tool>"
// action, a genuinely different label for a genuinely different purpose.
let kindLabelsPromise = null;
export function loadKindLabels() {
  if (!kindLabelsPromise) {
    kindLabelsPromise = loadLibraryKinds()
      .then((kinds) => Object.fromEntries(kinds.map((kind) => [kind.id, kind.label || kind.id])))
      .catch(() => ({}));
  }
  return kindLabelsPromise;
}

// {"kind:id" -> name} for a small, mixed set of {kind,id} targets. Two
// sources per kind, merged: fetchKindEntrySummaries (remote /list metadata
// only, zero per-record fetches — cheap for the common case) PLUS
// listLocalEntries (already in memory, zero network cost) — an anonymous
// GM's own local-only NPC/Location/... still gets a real label instead of
// falling back to its bare id, same "local-first" reasoning
// fetchAllRelationships above documents. Exported so relationship-editor.js
// reuses this instead of a second, separately-maintained label resolver.
export async function resolveLabelsForTargets(dataManager, targets) {
  const idsByKind = new Map();
  targets.forEach(({ kind, id }) => {
    if (!idsByKind.has(kind)) idsByKind.set(kind, new Set());
    idsByKind.get(kind).add(id);
  });
  const labels = new Map();
  await Promise.all(
    Array.from(idsByKind.entries()).map(async ([kind, ids]) => {
      const summaries = await fetchKindEntrySummaries(dataManager, kind).catch(() => []);
      summaries.forEach((summary) => {
        if (ids.has(summary.id)) labels.set(nodeKey(kind, summary.id), summary.name);
      });
      (dataManager.listLocalEntries(kind) || []).forEach((entry) => {
        if (!ids.has(entry.id) || labels.has(nodeKey(kind, entry.id))) return;
        const record = entry.payload || {};
        labels.set(nodeKey(kind, entry.id), record?.data?.name || record?.name || record?.title || entry.id);
      });
    })
  );
  return labels;
}

// Assembles `{nodes, edges}` for graph-view.js's createForceGraph, given the
// PRIMARY node set the caller already has in hand (Forge already lists its
// own NPCs, Crucible its own Monsters, ...) — this module doesn't own how a
// caller scopes that (by Setting, by System, whatever), only how edges
// touching it get resolved and how any OTHER-kind target gets a label.
// `extraEdges` — synthetic, non-removable edges from a kind's own existing
// relationship fields (Location's parentId/connectedTo today), same
// `{fromKind, fromId, toKind, toId, type}` shape, `synthetic: true`.
// Returns `iconByKind` too, so a caller's own `getNodeIcon` is a one-line
// lookup rather than a second kind-registry fetch.
export async function buildRelationshipGraph(dataManager, { nodes = [], extraEdges = [] } = {}) {
  const primaryKeys = new Set(nodes.map((node) => nodeKey(node.kind, node.id)));
  const stored = await fetchAllRelationships(dataManager);
  const allEdges = [...stored, ...extraEdges];
  const relevant = allEdges.filter(
    (edge) => primaryKeys.has(nodeKey(edge.fromKind, edge.fromId)) || primaryKeys.has(nodeKey(edge.toKind, edge.toId))
  );

  const extraTargets = new Map(); // key -> {kind, id}
  relevant.forEach((edge) => {
    [
      { kind: edge.fromKind, id: edge.fromId },
      { kind: edge.toKind, id: edge.toId },
    ].forEach((target) => {
      const key = nodeKey(target.kind, target.id);
      if (!primaryKeys.has(key) && !extraTargets.has(key)) extraTargets.set(key, target);
    });
  });

  const [labels, kinds] = await Promise.all([
    resolveLabelsForTargets(dataManager, Array.from(extraTargets.values())),
    loadLibraryKinds(),
  ]);
  const iconByKind = Object.fromEntries(kinds.map((kind) => [kind.id, kind.icon]));

  const extraNodes = Array.from(extraTargets.entries()).map(([key, target]) => ({
    id: key,
    kind: target.kind,
    label: labels.get(key) || target.id,
  }));
  const graphNodes = [
    ...nodes.map((node) => ({ id: nodeKey(node.kind, node.id), kind: node.kind, label: node.label })),
    ...extraNodes,
  ];
  const graphEdges = relevant.map((edge) => ({
    a: nodeKey(edge.fromKind, edge.fromId),
    b: nodeKey(edge.toKind, edge.toId),
    type: edge.type || "related",
    edgeId: edge.id,
    synthetic: Boolean(edge.synthetic),
  }));

  return { nodes: graphNodes, edges: graphEdges, iconByKind };
}
