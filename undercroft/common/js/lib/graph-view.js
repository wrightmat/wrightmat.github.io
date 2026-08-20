// A generic force-directed relationship diagram — SVG nodes/edges, a small
// hand-rolled deterministic spring simulation, click/hover/selection, and
// pan/zoom (common/js/lib/pan-zoom.js) — originally extracted from Sanctum's
// own Location Graph (since removed — every tool's relationship graph is
// reached through its own Relationships mode now, see relationship-graph.js/
// relationship-editor.js) once a second consumer (Repository's Relationships
// view, repository/js/lib/relationships-graph.js) needed the exact same
// engine over a completely different kind of node/edge data. This module
// has NO domain knowledge at all — it takes a plain `{nodes: [{id, label,
// radius?}], edges: [{a, b, type}]}` shape and a couple of small callbacks;
// every caller owns turning its own real data (a Location's parentId/
// connectedTo, an NPC/Monster/Wonder's own relationship edges, or
// Repository's wikilinks/references) into that shape itself. A force layout
// (not a tree/org-chart) is the right shape here since node position carries
// no meaning beyond "roughly near its related neighbors" — none of this
// suite's relationship data is inherently hierarchical or spatial.
//
// `classPrefix` (default "graph") namespaces every CSS class this renders
// (`<prefix>-node`, `<prefix>-edge`, ...) — each caller's OWN stylesheet
// still owns the actual look, matching this suite's "handout.js/dashboard
// widgets can't rely on a tool's own CSS file" convention (chips/callouts
// elsewhere in the suite solve the same problem with inline styles instead;
// a graph's per-node/edge styling is complex enough that CSS classes stay
// the right tool here, just kept from colliding across tools via the
// prefix).
import { PanZoomController } from "./pan-zoom.js";
import { createEmptyStateCard } from "./ui-components.js";

const SVG_NS = "http://www.w3.org/2000/svg";
const CANVAS_W = 1000;
const CANVAS_H = 700;
const ITERATIONS = 250;
const REPEL_K = 12000;
const MAX_REPEL_FORCE = 40;
const SPRING_K = 0.02;
const REST_LENGTH = 90;
const CENTER_K = 0.002;
const DAMPING = 0.85;
const NODE_MARGIN = 30;

const clamp = (value, min, max) => Math.min(Math.max(value, min), max);

// A plain, stable string hash (not Math.random()) — the only thing this
// needs to do is turn a node's own id into the same jitter every time, so
// re-seeding an unchanged node set never visibly moves anything.
function hashString(str) {
  let hash = 0;
  for (let i = 0; i < str.length; i++) {
    hash = (hash * 31 + str.charCodeAt(i)) | 0;
  }
  return Math.abs(hash);
}

function svgEl(tag, attrs = {}) {
  const node = document.createElementNS(SVG_NS, tag);
  Object.entries(attrs).forEach(([key, value]) => node.setAttribute(key, String(value)));
  return node;
}

function truncateLabel(name, max = 16) {
  if (!name) return "";
  return name.length > max ? `${name.slice(0, max - 1)}…` : name;
}

// BFS depth from every root, used only to seed initial ring positions
// before the simulation refines them — never meaningful on its own.
// `resolveParent(node, idSet) => parentId|null` is the ONE piece of domain
// knowledge a caller can optionally supply, for a hierarchical dataset (a
// single-parent tree like Region→Settlements) that wants a sensible starting
// shape instead of every node seeding as its own root; omitted entirely
// (every current consumer — Relationships' own adapter has no single-parent
// hierarchy to speak of), every node is simply its own root — the
// simulation's own repulsion/spring/centering forces still do the real
// clustering work either way, this only affects how good the FIRST frame
// looks before it settles.
export function computeDepths(nodes, idSet, resolveParent) {
  const childrenOf = new Map(nodes.map((node) => [node.id, []]));
  const roots = [];
  nodes.forEach((node) => {
    const parentId = typeof resolveParent === "function" ? resolveParent(node, idSet) : null;
    if (parentId && childrenOf.has(parentId)) childrenOf.get(parentId).push(node.id);
    else roots.push(node.id);
  });
  const depths = new Map();
  const visited = new Set(roots);
  const queue = roots.map((id) => ({ id, depth: 0 }));
  while (queue.length) {
    const { id, depth } = queue.shift();
    depths.set(id, depth);
    (childrenOf.get(id) || []).forEach((childId) => {
      if (visited.has(childId)) return;
      visited.add(childId);
      queue.push({ id: childId, depth: depth + 1 });
    });
  }
  nodes.forEach((node) => {
    if (!depths.has(node.id)) depths.set(node.id, 0);
  });
  return depths;
}

// Initial positions: rings by BFS depth, angle by index-within-depth, a
// small hash-derived jitter so nodes at the exact same depth/angle don't
// start perfectly stacked. Already roughly legible before the simulation
// below ever runs, so the solver mostly refines rather than untangling a
// bad guess from scratch.
export function seedPositions(nodes, depths) {
  const byDepth = new Map();
  nodes.forEach((node) => {
    const depth = depths.get(node.id) || 0;
    if (!byDepth.has(depth)) byDepth.set(depth, []);
    byDepth.get(depth).push(node.id);
  });
  const positions = new Map();
  const cx = CANVAS_W / 2;
  const cy = CANVAS_H / 2;
  byDepth.forEach((ids, depth) => {
    const radius = 70 + depth * 100;
    ids.forEach((id, index) => {
      const angle = (index / ids.length) * Math.PI * 2 + (hashString(id) % 100) / 100;
      const jitter = (hashString(`${id}:jitter`) % 20) - 10;
      positions.set(id, {
        x: cx + Math.cos(angle) * radius + jitter,
        y: cy + Math.sin(angle) * radius + jitter,
      });
    });
  });
  return positions;
}

// Damped spring simulation, mutating `positions` in place. Every edge pulls
// identically regardless of its own `type` — only rendering (below) tells
// edge types apart visually; the physics has no opinion on what a "parent"
// vs "connection" vs "wikilink" vs "reference" edge means semantically.
export function runSimulation(nodes, edges, positions) {
  const ids = nodes.map((node) => node.id);
  const velocities = new Map(ids.map((id) => [id, { x: 0, y: 0 }]));
  const cx = CANVAS_W / 2;
  const cy = CANVAS_H / 2;

  for (let iteration = 0; iteration < ITERATIONS; iteration++) {
    const forces = new Map(ids.map((id) => [id, { x: 0, y: 0 }]));

    for (let i = 0; i < ids.length; i++) {
      for (let j = i + 1; j < ids.length; j++) {
        const a = positions.get(ids[i]);
        const b = positions.get(ids[j]);
        let dx = a.x - b.x;
        let dy = a.y - b.y;
        let distSq = dx * dx + dy * dy;
        if (distSq < 1) {
          // Coincident nodes (a rare seeded overlap) — nudge apart along a
          // hash-derived direction so they don't divide-by-zero and never
          // separate.
          dx = ((hashString(ids[i] + ids[j]) % 10) - 5) || 1;
          dy = 1;
          distSq = dx * dx + dy * dy;
        }
        const dist = Math.sqrt(distSq);
        const force = Math.min(REPEL_K / distSq, MAX_REPEL_FORCE);
        const fx = (dx / dist) * force;
        const fy = (dy / dist) * force;
        forces.get(ids[i]).x += fx;
        forces.get(ids[i]).y += fy;
        forces.get(ids[j]).x -= fx;
        forces.get(ids[j]).y -= fy;
      }
    }

    edges.forEach(([aId, bId]) => {
      const a = positions.get(aId);
      const b = positions.get(bId);
      if (!a || !b) return;
      const dx = b.x - a.x;
      const dy = b.y - a.y;
      const dist = Math.max(Math.hypot(dx, dy), 0.01);
      const force = SPRING_K * (dist - REST_LENGTH);
      const fx = (dx / dist) * force;
      const fy = (dy / dist) * force;
      forces.get(aId).x += fx;
      forces.get(aId).y += fy;
      forces.get(bId).x -= fx;
      forces.get(bId).y -= fy;
    });

    ids.forEach((id) => {
      const pos = positions.get(id);
      const force = forces.get(id);
      force.x += (cx - pos.x) * CENTER_K;
      force.y += (cy - pos.y) * CENTER_K;
      const vel = velocities.get(id);
      vel.x = (vel.x + force.x) * DAMPING;
      vel.y = (vel.y + force.y) * DAMPING;
      pos.x = clamp(pos.x + vel.x, NODE_MARGIN, CANVAS_W - NODE_MARGIN);
      pos.y = clamp(pos.y + vel.y, NODE_MARGIN, CANVAS_H - NODE_MARGIN);
    });
  }
}

function applySelectionClasses(svg, selectedId, classPrefix) {
  svg.querySelectorAll(`.${classPrefix}-node`).forEach((node) => {
    node.classList.toggle(`${classPrefix}-node-selected`, node.dataset.nodeId === selectedId);
  });
  svg.querySelectorAll(`.${classPrefix}-edge`).forEach((line) => {
    const touches = Boolean(selectedId) && (line.dataset.a === selectedId || line.dataset.b === selectedId);
    line.classList.toggle(`${classPrefix}-edge-selected`, touches);
  });
}

// `getNodeRadius(node) => number` — required, every caller has SOME notion
// of node sizing (every Relationships graph across the suite: a node's own
// kind, sized up for the record centered on). `getNodeIcon(node) =>
// iconName|null` — optional; when supplied, an iconify glyph renders
// centered in the node (via a small <foreignObject> — the only practical
// way to place an HTML custom element like <span class="iconify"> inside
// SVG), letting Relationships show an NPC/Location/Page/... icon per node
// using each kind's own already-registered icon (loadLibraryKinds())
// rather than a new hardcoded lookup table; omitted, nodes render as plain
// circles exactly as they always have. `getEdgeLabel(edge) => string|null`
// — optional; when supplied, a small text label renders at each edge's own
// midpoint (the relationship-graph.js consumers' own edge `type`, e.g.
// "Member of") — omitted (Repository's own existing adapter, unchanged),
// edges render exactly as they always have with no label text at all.
function render(svg, nodes, edges, positions, { selectedId, getNodeRadius, getNodeIcon, getEdgeLabel, onSelect, classPrefix }) {
  while (svg.firstChild) svg.removeChild(svg.firstChild);
  const edgeGroup = svgEl("g", { class: `${classPrefix}-edges` });
  const edgeLabelGroup = svgEl("g", { class: `${classPrefix}-edge-labels` });
  const nodeGroup = svgEl("g", { class: `${classPrefix}-nodes` });
  svg.append(edgeGroup, edgeLabelGroup, nodeGroup);

  edges.forEach((edge) => {
    const a = positions.get(edge.a);
    const b = positions.get(edge.b);
    if (!a || !b) return;
    const selected = edge.a === selectedId || edge.b === selectedId;
    const line = svgEl("line", {
      x1: a.x,
      y1: a.y,
      x2: b.x,
      y2: b.y,
      class: `${classPrefix}-edge ${classPrefix}-edge-${edge.type}${selected ? ` ${classPrefix}-edge-selected` : ""}`,
    });
    line.dataset.a = edge.a;
    line.dataset.b = edge.b;
    edgeGroup.appendChild(line);

    const labelText = typeof getEdgeLabel === "function" ? getEdgeLabel(edge) : null;
    if (labelText) {
      const label = svgEl("text", {
        class: `${classPrefix}-edge-label`,
        x: (a.x + b.x) / 2,
        y: (a.y + b.y) / 2,
        "text-anchor": "middle",
      });
      label.textContent = labelText;
      edgeLabelGroup.appendChild(label);
    }
  });

  nodes.forEach((node) => {
    const pos = positions.get(node.id);
    if (!pos) return;
    const radius = typeof getNodeRadius === "function" ? getNodeRadius(node) : 16;
    const selected = node.id === selectedId;
    const g = svgEl("g", {
      class: `${classPrefix}-node${selected ? ` ${classPrefix}-node-selected` : ""}`,
      transform: `translate(${pos.x}, ${pos.y})`,
      tabindex: "0",
      role: "button",
      "aria-label": node.label || node.id,
    });
    g.dataset.nodeId = node.id;
    // Harmless empty string for a caller whose nodes don't carry a `kind`
    // at all — lets a caller that DOES have more than one node kind
    // (Repository's Relationships view: journal/quest/npc/location/...)
    // style them apart via a plain CSS attribute selector without this
    // module needing to know what any of those kinds mean.
    g.dataset.nodeKind = node.kind || "";
    const circle = svgEl("circle", { r: radius, class: `${classPrefix}-node-circle` });
    const title = svgEl("title");
    title.textContent = node.label || node.id;
    g.append(circle, title);
    const iconName = typeof getNodeIcon === "function" ? getNodeIcon(node) : null;
    if (iconName) {
      const iconSize = radius * 1.1;
      const foreign = svgEl("foreignObject", {
        x: -iconSize / 2,
        y: -iconSize / 2,
        width: iconSize,
        height: iconSize,
        class: `${classPrefix}-node-icon-box`,
      });
      // xmlns required on the foreignObject's own body element in some
      // browsers' SVG-in-XML serialization — cheap to always set.
      const body = document.createElementNS("http://www.w3.org/1999/xhtml", "div");
      body.style.width = "100%";
      body.style.height = "100%";
      body.style.display = "flex";
      body.style.alignItems = "center";
      body.style.justifyContent = "center";
      const iconSpan = document.createElement("span");
      iconSpan.className = `iconify ${classPrefix}-node-icon`;
      iconSpan.dataset.icon = iconName;
      iconSpan.setAttribute("aria-hidden", "true");
      body.appendChild(iconSpan);
      foreign.appendChild(body);
      g.appendChild(foreign);
    }
    const label = svgEl("text", {
      class: `${classPrefix}-node-label`,
      y: radius + 14,
      "text-anchor": "middle",
    });
    label.textContent = truncateLabel(node.label);
    g.appendChild(label);
    // Stops this pointerdown from ever reaching `container`'s own listener
    // (PanZoomController's drag-to-pan handler) — confirmed real bug
    // without this: the container calls setPointerCapture on every
    // pointerdown regardless of target, which hijacks the subsequent
    // synthesized "click" event before it ever reaches this node, so
    // clicking a node silently did nothing. A plain click (no drag) on the
    // node itself never needs to pan anyway.
    g.addEventListener("pointerdown", (event) => event.stopPropagation());
    const select = () => onSelect?.(node.id);
    g.addEventListener("click", select);
    g.addEventListener("keydown", (event) => {
      if (event.key === "Enter" || event.key === " ") {
        event.preventDefault();
        select();
      }
    });
    nodeGroup.appendChild(g);
  });
}

// `container`/`content`/`svg` — the pan-zoom stage trio (see this module's
// own PanZoomController import, and its own header comment for the CSS
// this requires: `content` positioned `left:50%; top:50%;` inside
// `container`). `emptyMount` — a sibling slot shown instead of `container`
// when there's nothing to graph. `onSelect(id)` — called on node
// click/Enter. `resolveParent(node, idSet) => parentId|null` — optional,
// see computeDepths' own comment.
// `edgeLabelZoomThreshold` — only meaningful alongside `getEdgeLabel`; a
// relationship-graph.js consumer's own edge-type text (e.g. "Member of")
// stays hidden until zoomed in at least this far, so a graph with many
// edges doesn't read as a wall of overlapping text at the default zoom —
// see the `${classPrefix}-content` class this toggles, and the CSS rule
// each caller's own stylesheet defines for it (shell.css's own
// `.relationship-graph-content` block is the one real consumer today).
export function createForceGraph({
  container,
  content,
  svg,
  emptyMount,
  onSelect,
  getNodeRadius,
  getNodeIcon,
  getEdgeLabel,
  resolveParent,
  classPrefix = "graph",
  emptyIcon = "tabler:route-off",
  emptyMessage = "Nothing to graph yet.",
  defaultZoom = 2.0,
  minZoom = 0.75,
  maxZoom = 6,
  edgeLabelZoomThreshold = 1.75,
}) {
  if (!container || !content || !svg) {
    return { setGraph() {}, setSelected() {}, zoomBy() {}, reset() {}, destroy() {} };
  }

  function updateEdgeLabelVisibility(zoom) {
    if (typeof getEdgeLabel !== "function") return;
    content.classList.toggle(`${classPrefix}-edge-labels-visible`, zoom >= edgeLabelZoomThreshold);
  }

  const panZoom = new PanZoomController({
    container,
    content,
    view: { zoom: defaultZoom },
    minZoom,
    maxZoom,
    onChange: (view) => updateEdgeLabelVisibility(view.zoom),
  });
  updateEdgeLabelVisibility(defaultZoom);

  let lastIdKey = null;
  let positions = new Map();
  let currentNodes = [];
  let currentEdges = [];
  let selectedId = null;
  let emptyCardBuilt = false;

  function ensureEmptyCard() {
    if (emptyCardBuilt || !emptyMount) return;
    emptyMount.appendChild(createEmptyStateCard({ icon: emptyIcon, message: emptyMessage }));
    emptyCardBuilt = true;
  }

  // Full rebuild (re-seed + re-simulate) only when the node-id SET itself
  // changes — an edge-only change among already-visible nodes (or an
  // unrelated field edit) still redraws correctly (edges/labels rebuild
  // every call) without ever repositioning anything, so the graph never
  // visibly jumps for a change that isn't structural.
  function setGraph({ nodes, edges } = {}) {
    currentNodes = Array.isArray(nodes) ? nodes : [];
    currentEdges = Array.isArray(edges) ? edges : [];
    if (!currentNodes.length) {
      lastIdKey = "";
      container.classList.add("d-none");
      if (emptyMount) {
        ensureEmptyCard();
        emptyMount.classList.remove("d-none");
      }
      return;
    }
    container.classList.remove("d-none");
    emptyMount?.classList.add("d-none");

    const idSet = new Set(currentNodes.map((node) => node.id));
    const idKey = currentNodes
      .map((node) => node.id)
      .sort()
      .join(",");
    if (idKey !== lastIdKey) {
      const depths = computeDepths(currentNodes, idSet, resolveParent);
      positions = seedPositions(currentNodes, depths);
      runSimulation(
        currentNodes,
        currentEdges.map((edge) => [edge.a, edge.b]),
        positions
      );
      lastIdKey = idKey;
    }
    render(svg, currentNodes, currentEdges, positions, { selectedId, getNodeRadius, getNodeIcon, getEdgeLabel, onSelect, classPrefix });
  }

  function setSelected(id) {
    selectedId = id || null;
    applySelectionClasses(svg, selectedId, classPrefix);
  }

  return {
    setGraph,
    setSelected,
    zoomBy: (delta) => panZoom.zoomBy(delta),
    reset: () => panZoom.reset({ zoom: defaultZoom }),
    destroy: () => panZoom.destroy(),
  };
}
