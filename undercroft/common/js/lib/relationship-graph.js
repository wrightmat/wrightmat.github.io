// The suite-wide relationship graph — a `relationship` Library record IS one
// edge (`{fromKind, fromId, toKind, toId, type, label, value}`), any two
// records of any kind, `type` free text (never a hard enum). Just another
// Library kind (common/data/kind/relationship.json), so the generic
// save/list/get/delete/share routes support it with no per-kind server code.
//
// Edges are directed even for symmetric-reading types ("Allied with") — a
// record's own Relationships section shows edges touching it from EITHER
// direction (fetchEdgesTouching), which is also how "Organizations" fall
// out for free: an NPC other NPCs point at with "Member of" edges shows
// those rows in its own list too, the reverse direction of the same query.
//
// Sanctum's parentId/connectedTo are DERIVED from this kind, not a second
// source of truth — applyDerivedLocationHierarchy recomputes that in-memory
// shape from real relationship edges on every load, only for dungeon-gen's
// legacy consumers that still expect it locally; nothing persists in that
// scalar form anymore. A caller can fold in non-`relationship` data as
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
// toKind, toId, type, label, value}`. Fetch-everything-then-filter
// client-side, same pattern used suite-wide (no server-side indexed
// queries).
//
// Deliberately NOT fetchKindEntriesWithIds (content-fetch.js) — that's
// remote-only, but an anonymous GM's own relationships must keep working
// per the suite's local-first-saving rule. Merges remote+local like
// content-picker.js — remote wins on an id collision.
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
// doesn't change mid-session). relationship-editor.js uses this to show a
// relationship's OTHER end as its entity type ("NPC", "Location") rather
// than which tool owns it — kindToolLabel (kind-tool-route.js) is reserved
// for the "Open in <Tool>" action, a different label for a different purpose.
let kindLabelsPromise = null;
export function loadKindLabels() {
  if (!kindLabelsPromise) {
    kindLabelsPromise = loadLibraryKinds()
      .then((kinds) => Object.fromEntries(kinds.map((kind) => [kind.id, kind.label || kind.id])))
      .catch(() => ({}));
  }
  return kindLabelsPromise;
}

// {"kind:id" -> name} for a small, mixed set of {kind,id} targets. Merges
// fetchKindEntrySummaries (remote /list metadata, no per-record fetches)
// with listLocalEntries (already in memory) so an anonymous GM's local-only
// records still get a real label instead of falling back to a bare id.
// Exported so relationship-editor.js reuses this instead of a second
// label resolver.
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
// PRIMARY node set the caller already has (Forge's own NPCs, Crucible's own
// Monsters, ...) — this module only resolves edges touching it and labels
// any OTHER-kind target. `extraEdges` are synthetic, non-removable edges
// from a kind's own existing relationship fields (Location's
// parentId/connectedTo), same shape plus `synthetic: true`. Also returns
// `iconByKind` so a caller's `getNodeIcon` is a one-line lookup.
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
