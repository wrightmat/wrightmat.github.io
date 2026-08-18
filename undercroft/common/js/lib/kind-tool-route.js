// Which tool "owns" each Library kind, and how to build a deep link into it
// for one specific record — shared by Repository's own reference-chip open
// action (journal-kind-reference.js/app.js) and Orrery/Map widget's marker
// "Open in <Tool>" link-out (map-viewer.js), rather than two independently
// maintained copies of the same routing table silently drifting apart.
//
// Every route's own `value()` reads nothing off `record` but `.id` — so
// building a URL never needs the full fetched entity, just the id already
// known locally (a marker's own refId, a reference chip's own resolved
// record id).
import { resolveToolHref, resolveToolContextPath } from "./app-shell.js";

export const KIND_TOOL_ROUTE = {
  npc: { tool: "forge", toolLabel: "Forge", param: "npc" },
  monster: { tool: "crucible", toolLabel: "Crucible", param: "monster" },
  effect: { tool: "vault", toolLabel: "Vault", param: "effect" },
  location: { tool: "sanctum", toolLabel: "Sanctum", param: "location" },
  setting: { tool: "sanctum", toolLabel: "Sanctum", param: "setting" },
  system: { tool: "loom", toolLabel: "Loom", param: "system" },
  feature: { tool: "loom", toolLabel: "Loom", param: "feature" },
  macro: { tool: "loom", toolLabel: "Loom", param: "macro" },
  map: { tool: "orrery", toolLabel: "Orrery", param: "map" },
  // No `value()` override needed — Repository's own `?page=<id>` deep link
  // already exists (bookmarking/reloading a page); `extraParams` below is
  // how a specific heading/quest anchor rides along on top of it.
  journal: { tool: "repository", toolLabel: "Repository", param: "page" },
  character: { tool: "workbench", toolLabel: "Workbench", param: "record", value: (record) => `characters:${record.id}` },
  template: { tool: "workbench", toolLabel: "Workbench", param: "record", value: (record) => `templates:${record.id}` },
  "monster-archetype": { tool: "loom", toolLabel: "Loom", param: "library", value: (record) => `monster-archetype:${record.id}` },
  "monster-role": { tool: "loom", toolLabel: "Loom", param: "library", value: (record) => `monster-role:${record.id}` },
  "location-type": { tool: "loom", toolLabel: "Loom", param: "library", value: (record) => `location-type:${record.id}` },
  "location-purpose": { tool: "loom", toolLabel: "Loom", param: "library", value: (record) => `location-purpose:${record.id}` },
  resource: { tool: "loom", toolLabel: "Loom", param: "library", value: (record) => `resource:${record.id}` },
  class: { tool: "loom", toolLabel: "Loom", param: "library", value: (record) => `class:${record.id}` },
  subclass: { tool: "loom", toolLabel: "Loom", param: "library", value: (record) => `subclass:${record.id}` },
  background: { tool: "loom", toolLabel: "Loom", param: "library", value: (record) => `background:${record.id}` },
  species: { tool: "loom", toolLabel: "Loom", param: "library", value: (record) => `species:${record.id}` },
  variant: { tool: "loom", toolLabel: "Loom", param: "library", value: (record) => `variant:${record.id}` },
};

// `extraParams` (e.g. a journal anchor's `{heading: "..."}`) merges into the
// query string alongside the route's own primary param. Returns null for a
// kind with no route (nothing to link to) or a missing id.
export function buildKindToolUrl(kindId, id, { extraParams } = {}) {
  const route = KIND_TOOL_ROUTE[kindId];
  if (!route || !id) return null;
  const value = route.value ? route.value({ id }) : id;
  const params = new URLSearchParams({ [route.param]: value });
  if (extraParams) {
    Object.entries(extraParams).forEach(([key, val]) => {
      if (val) params.set(key, val);
    });
  }
  return `${resolveToolHref(route.tool, resolveToolContextPath())}?${params.toString()}`;
}

export function kindToolLabel(kindId) {
  return KIND_TOOL_ROUTE[kindId]?.toolLabel || "";
}
