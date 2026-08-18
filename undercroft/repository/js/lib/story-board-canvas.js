// The interactive visual editor for a Story Board (journal-story-board.js's
// own parsed model) — a GM-constructed planning surface, not something
// derived from other content (see that file's own header comment, and
// relationships-graph.js's own explicit boundary: this canvas's own
// nodes/edges never leak into Relationships until a placeholder gets
// promoted into real, separately-linked content).
//
// Two layout modes over the SAME node data — every node carries both a
// free {x, y} position (freeform) and an optional {lane, stage} assignment
// (swimlane); switching modes just changes which fields drive rendering,
// never touches the other. Freeform reuses common/js/lib/pan-zoom.js
// directly for the corkboard's own pan/zoom; node drag is self-contained
// pointerdown/move/up handling (not a separate "click" listener after the
// fact) — same lesson graph-view.js's own node-click bug already taught
// this suite: PanZoomController's container calls setPointerCapture on
// every pointerdown regardless of target, so a node's own pointerdown must
// stopPropagation before that ever happens, whether or not a real drag
// follows.
//
// Every edit calls back through `onMutate(mutateFn)` — a PURE function
// `(model) => nextModel`, the exact same shape journal-story-board.js's own
// updateStoryBoardInPage expects, applied here for immediate local
// feedback AND handed to the caller (repository/js/app.js) to apply
// against a freshly re-parsed copy of the persisted page body, so local
// and persisted state can never diverge from applying two different
// transforms.
import { el } from "../../../common/js/lib/dom.js";
import { PanZoomController } from "../../../common/js/lib/pan-zoom.js";
import { resolveColor } from "./journal-callouts.js";
import { createFormFloatingField, createCycleToggleButton, createIconButton } from "../../../common/js/lib/ui-components.js";
import { refreshTooltips, disposeTooltips } from "../../../common/js/lib/tooltips.js";

const SVG_NS = "http://www.w3.org/2000/svg";
// Also hardcoded as `.story-board-content`'s own fixed width/height in
// styles.css (see that rule's own comment for why it has to be a real
// fixed size, not 100%) — change both together, or the SVG edge layer and
// the plain-HTML card layer stop agreeing on where a given x/y actually is.
const CANVAS_W = 1000;
const CANVAS_H = 700;
const DEFAULT_ZOOM = 1.2;
const MIN_ZOOM = 0.2;
const MAX_ZOOM = 3;

function svgEl(tag, attrs = {}) {
  const node = document.createElementNS(SVG_NS, tag);
  Object.entries(attrs).forEach(([key, value]) => node.setAttribute(key, String(value)));
  return node;
}

function randomId() {
  if (typeof crypto !== "undefined" && typeof crypto.randomUUID === "function") return crypto.randomUUID();
  return `n${Math.random().toString(16).slice(2)}`;
}

// HTML `id` attributes can't contain whitespace — a node's own `id` is a
// free-text display label (e.g. "Find the Merchant"), so every DOM id this
// module derives from one needs slugifying first, not just string-
// concatenated as-is.
function domIdFor(prefix, nodeId) {
  const slug = String(nodeId || "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/(^-+|-+$)/g, "");
  return `${prefix}-${slug || randomId()}`;
}

// --- Pure model mutations — each one handed BOTH to local state and to
// the caller's own updateStoryBoardInPage call, see this file's own header
// comment for why that's the one thing every mutation here must stay. ---

function withNodePosition(id, x, y) {
  return (model) => ({ ...model, nodes: model.nodes.map((node) => (node.id === id ? { ...node, x, y } : node)) });
}

function withNodeField(id, patch) {
  return (model) => ({ ...model, nodes: model.nodes.map((node) => (node.id === id ? { ...node, ...patch } : node)) });
}

function withNewNode(node) {
  return (model) => ({ ...model, nodes: [...model.nodes, node] });
}

function withRemovedNode(id) {
  return (model) => ({
    ...model,
    nodes: model.nodes.filter((node) => node.id !== id),
    edges: model.edges.filter((edge) => edge.from !== id && edge.to !== id),
  });
}

function withNewEdge(edge) {
  return (model) => ({ ...model, edges: [...model.edges, edge] });
}

function withRemovedEdge(index) {
  return (model) => ({ ...model, edges: model.edges.filter((_, i) => i !== index) });
}

function withLayoutMode(layoutMode) {
  return (model) => ({ ...model, layoutMode });
}

function withLanes(lanes) {
  return (model) => ({ ...model, lanes });
}

function withStages(stages) {
  return (model) => ({ ...model, stages });
}

// `container` — an empty element this owns entirely (wiped/rebuilt on
// every render). `model` — journal-story-board.js's own parsed shape.
// `onMutate(mutateFn)` — see this file's own header comment.
// `resolveRef(ref) => {label, icon}|null` — optional; lets the caller
// resolve a node's own Ref cell against real Library/quest data for
// display (icon, a friendlier label) without this module needing a
// dataManager of its own. `openRefPicker() => Promise<string|null>` —
// optional; opens whatever kind+entity picker the caller already has
// (Handout's own convention) and resolves to a new `kindId:Name` ref
// string, or null if cancelled — used by the node inspector's own
// "Promote to real content" and "Change reference" actions.
// `modeSlot` — optional; the reserved `.callout-mode-slot` element
// markdown.js's own applyCalloutStyling builds into EVERY callout's title
// bar (generic, not story-board-specific — see that function's own
// comment). When given, the Corkboard/Swimlane View toggle
// (ui-components.js's own createCycleToggleButton — a single cycling
// button, the suite-wide View shape, NOT the two-button check-group this
// used before) mounts there instead of inside this module's own internal
// toolbar, which then keeps only "Add node." Omitted, the toggle falls
// back to living in the internal toolbar (keeps this function usable
// standalone, without requiring a caller to also thread a title-bar slot
// through).
export function mountStoryBoard(container, { model, onMutate, resolveRef, openRefPicker, status, modeSlot } = {}) {
  if (!container) return { update() {}, destroy() {} };

  let currentModel = model || { layoutMode: "freeform", lanes: [], stages: [], nodes: [], edges: [] };
  let selectedNodeId = null;
  let panZoom = null;
  let destroyed = false;

  function applyMutation(mutateFn) {
    currentModel = mutateFn(currentModel) || currentModel;
    render();
    onMutate?.(mutateFn);
  }

  function findNode(id) {
    return currentModel.nodes.find((node) => node.id === id) || null;
  }

  // The suite-wide View control (ui-components.js's own
  // createCycleToggleButton) — ONE button cycling between Swimlane and
  // Corkboard, icon+tooltip only, describing what clicking switches TO.
  // Mounts into `modeSlot` (the callout's own title bar) when given,
  // otherwise falls back into this module's own internal toolbar — either
  // way this is the SAME rebuild-fresh-on-every-render() function, just
  // appended to a different host.
  function renderLayoutModeToggle() {
    // Swimlane first — a saved board's own layoutMode (Swimlane for
    // anything hand-authored with Lanes/Stages already filled in) is the
    // more common initial state, so the toggle offers switching TO
    // Corkboard first when starting from Swimlane, matching how a GM is
    // more likely to actually use this.
    return createCycleToggleButton({
      states: [
        {
          value: "swimlane",
          icon: "tabler:layout-grid",
          label: "Swimlane",
          tooltip: "Swimlane — a grid of Lane × Stage, each node placed in one cell",
        },
        {
          value: "freeform",
          icon: "tabler:layout-board",
          label: "Corkboard",
          tooltip: "Corkboard — free placement, drag nodes anywhere, draw edges between them",
        },
      ],
      value: currentModel.layoutMode,
      onSelect: (next) => applyMutation(withLayoutMode(next)),
    });
  }

  // --- Toolbar ---------------------------------------------------------
  // Sits directly above the node canvas/grid only (see render() below,
  // which nests this inside the same column as the stage — not the whole
  // card), so "Add node" pushed to the right edge here lands above the
  // nodes themselves, not above the inspector panel too.
  function renderToolbar() {
    const bar = el("div", "d-flex align-items-center gap-2 flex-wrap mb-2");
    if (!modeSlot) bar.appendChild(renderLayoutModeToggle());

    // Add Lane/Add Stage moved OUT of this toolbar entirely — see
    // renderSwimlane's own `+` cells at the actual edge of the grid they
    // each extend, rather than a pair of buttons here that only made sense
    // in one of the two modes.
    bar.appendChild(
      createIconButton({
        icon: "tabler:square-plus",
        label: "Add node",
        variant: "primary",
        className: "ms-auto",
        onClick: () => {
          const id = uniqueNodeId("New Node");
          applyMutation(withNewNode({ id, type: "placeholder", ref: "", lane: currentModel.lanes[0] || "", stage: currentModel.stages[0] || "", x: CANVAS_W / 2, y: CANVAS_H / 2, color: "" }));
          selectedNodeId = id;
          render();
        },
      })
    );
    return bar;
  }

  function uniqueNodeId(base) {
    const existing = new Set(currentModel.nodes.map((node) => node.id.toLowerCase()));
    if (!existing.has(base.toLowerCase())) return base;
    let index = 2;
    while (existing.has(`${base} ${index}`.toLowerCase())) index += 1;
    return `${base} ${index}`;
  }

  // --- Node card (shared look, different positioning per mode) --------
  function nodeCardColor(node) {
    return node.color ? resolveColor(node.color) : null;
  }

  function buildNodeCard(node) {
    const card = el("div", "story-board-node-card d-flex align-items-center gap-1");
    card.classList.toggle("story-board-node-placeholder", node.type === "placeholder");
    card.classList.toggle("story-board-node-selected", node.id === selectedNodeId);
    const color = nodeCardColor(node);
    if (color) {
      card.style.borderColor = color.value;
      // Two layered background properties, not one `rgba(..., 0.12)` shorthand
      // — that alone left the WHOLE card only 12% opaque, letting an edge
      // line rendered behind it (see the edge/card z-index split above)
      // show straight through — confirmed real bug: every colored node had
      // this, uncolored ones (opaque `--bs-body-bg` from the base CSS rule)
      // never did, exactly matching "only some boxes have lines above them".
      // background-image (the tint, still translucent) paints OVER
      // background-color (a fully opaque base), so the composite stays
      // 100% opaque while the color accent still reads correctly.
      card.style.backgroundColor = "var(--bs-body-bg)";
      card.style.backgroundImage = `linear-gradient(rgba(${color.rgbValue}, 0.12), rgba(${color.rgbValue}, 0.12))`;
    }
    const resolved = node.ref && typeof resolveRef === "function" ? resolveRef(node.ref) : null;
    if (resolved?.icon) {
      const icon = el("span", "iconify flex-shrink-0");
      icon.dataset.icon = resolved.icon;
      icon.setAttribute("aria-hidden", "true");
      card.appendChild(icon);
    } else if (node.type === "placeholder") {
      const icon = el("span", "iconify flex-shrink-0");
      icon.dataset.icon = "tabler:point";
      icon.setAttribute("aria-hidden", "true");
      card.appendChild(icon);
    }
    card.appendChild(el("span", "story-board-node-label text-truncate", node.id));
    card.tabIndex = 0;
    card.dataset.nodeId = node.id;
    return card;
  }

  // --- Freeform mode: absolutely-positioned cards + an SVG edge overlay,
  // both inside the same pan-zoom content div so they pan/zoom together.
  function renderFreeform(host) {
    // Every drag/add/remove goes through applyMutation -> render(), which
    // tears this whole stage down and rebuilds it from scratch — a FRESH
    // PanZoomController every time, always re-seeded from DEFAULT_ZOOM,
    // silently threw away whatever pan/zoom the GM had actually set the
    // moment they finished dragging a single node. Capturing the outgoing
    // controller's own current view (before it's replaced) and reusing it
    // as the new one's starting view is what actually persists it —
    // confirmed real bug, not just a rebuild-is-expensive concern.
    const previousView = panZoom?.getView();
    const stage = el("div", "story-board-stage");
    const content = el("div", "story-board-content");
    const svg = svgEl("svg", { viewBox: `0 0 ${CANVAS_W} ${CANVAS_H}`, preserveAspectRatio: "xMidYMid meet", class: "story-board-edge-layer" });
    const cardLayer = el("div", "story-board-card-layer");
    content.append(svg, cardLayer);
    stage.appendChild(content);
    host.appendChild(stage);

    panZoom = new PanZoomController({
      container: stage,
      content,
      view: previousView || { zoom: DEFAULT_ZOOM },
      minZoom: MIN_ZOOM,
      maxZoom: MAX_ZOOM,
    });
    stage.addEventListener("pointerdown", (event) => {
      // A click on empty canvas (not a node) clears selection — the stage
      // itself still needs to receive this event for panning, so this
      // deliberately does NOT stopPropagation.
      if (event.target === stage || event.target === content) {
        selectedNodeId = null;
        render();
      }
    });

    const positions = new Map(currentModel.nodes.map((node) => [node.id, { x: node.x, y: node.y }]));

    function edgeLine(edge) {
      const a = positions.get(edge.from);
      const b = positions.get(edge.to);
      if (!a || !b) return null;
      const line = svgEl("line", { x1: a.x, y1: a.y, x2: b.x, y2: b.y, class: "story-board-edge" });
      line.dataset.from = edge.from;
      line.dataset.to = edge.to;
      return line;
    }
    currentModel.edges.forEach((edge) => {
      const line = edgeLine(edge);
      if (line) svg.appendChild(line);
    });

    function repositionEdges(nodeId, x, y) {
      positions.set(nodeId, { x, y });
      svg.querySelectorAll("line").forEach((line) => {
        if (line.dataset.from === nodeId) {
          line.setAttribute("x1", x);
          line.setAttribute("y1", y);
        }
        if (line.dataset.to === nodeId) {
          line.setAttribute("x2", x);
          line.setAttribute("y2", y);
        }
      });
    }

    currentModel.nodes.forEach((node) => {
      const card = buildNodeCard(node);
      card.style.position = "absolute";
      card.style.left = `${node.x}px`;
      card.style.top = `${node.y}px`;
      wireFreeformDrag(card, node, repositionEdges);
      cardLayer.appendChild(card);
    });
  }

  // Self-contained pointerdown/move/up — click-vs-drag is decided entirely
  // within this sequence (a small movement threshold), never a separate
  // "click" listener depending on the browser's own synthesized click
  // surviving the container's own pointer capture (see this file's own
  // header comment).
  function wireFreeformDrag(card, node, repositionEdges) {
    let dragging = false;
    let moved = false;
    let startClientX = 0;
    let startClientY = 0;
    let startX = 0;
    let startY = 0;
    card.addEventListener("pointerdown", (event) => {
      event.stopPropagation();
      card.setPointerCapture(event.pointerId);
      dragging = true;
      moved = false;
      startClientX = event.clientX;
      startClientY = event.clientY;
      startX = node.x;
      startY = node.y;
    });
    card.addEventListener("pointermove", (event) => {
      if (!dragging) return;
      const zoom = panZoom?.getView().zoom || 1;
      const dx = (event.clientX - startClientX) / zoom;
      const dy = (event.clientY - startClientY) / zoom;
      if (Math.abs(dx) > 2 || Math.abs(dy) > 2) moved = true;
      const nextX = startX + dx;
      const nextY = startY + dy;
      card.style.left = `${nextX}px`;
      card.style.top = `${nextY}px`;
      repositionEdges(node.id, nextX, nextY);
    });
    const finish = (event) => {
      if (!dragging) return;
      dragging = false;
      if (moved) {
        const zoom = panZoom?.getView().zoom || 1;
        const dx = (event.clientX - startClientX) / zoom;
        const dy = (event.clientY - startClientY) / zoom;
        applyMutation(withNodePosition(node.id, Math.round(startX + dx), Math.round(startY + dy)));
      } else {
        selectedNodeId = node.id;
        render();
      }
    };
    card.addEventListener("pointerup", finish);
    card.addEventListener("pointercancel", finish);
  }

  // --- Swimlane mode: a plain CSS grid, node cards placed by lane/stage.
  // Every cell's own grid-row/grid-column is set EXPLICITLY (not left to
  // CSS Grid's implicit row-wrapping auto-flow) — auto-flow only keeps
  // columns aligned when every row contributes exactly the same number of
  // cells, which the Add Lane/Add Stage `+` cells below break (each only
  // ever occupies ONE cell, not a full row/column), so explicit placement
  // is the only way to keep the header/cell grid itself honest regardless.
  function renderSwimlane(host) {
    const lanes = currentModel.lanes.length ? currentModel.lanes : ["(No lane)"];
    const stages = currentModel.stages.length ? currentModel.stages : ["(No stage)"];
    // +1 for the lane-header column, +1 for the trailing Add Stage column;
    // same shape for rows, +1 for the stage-header row, +1 for the
    // trailing Add Lane row.
    const totalCols = 2 + stages.length;
    const totalRows = 2 + lanes.length;
    const grid = el("div", "story-board-swimlane");
    grid.style.gridTemplateColumns = `10rem repeat(${stages.length}, minmax(10rem, 1fr)) 2.25rem`;
    grid.style.gridTemplateRows = `auto repeat(${lanes.length}, auto) 2.25rem`;

    function place(node, row, col) {
      node.style.gridRow = String(row);
      node.style.gridColumn = String(col);
      grid.appendChild(node);
    }
    // A plain, body-colored cell for every position the grid's own explicit
    // template creates but nothing actually occupies (the rest of the Add
    // Stage column below its own button, the rest of the Add Lane row
    // beside its own button) — without these, that space stays fully
    // unfilled and shows the grid container's own hairline-gap background
    // color as a solid stripe instead of blending in.
    function filler(row, col) {
      place(el("div", "story-board-swimlane-filler"), row, col);
    }

    place(el("div", "story-board-swimlane-corner"), 1, 1);
    // Stage-row vs. lane-column headers need their own modifier class (not
    // just the shared `.story-board-swimlane-header` both used to share) —
    // one sticks to the top edge, the other to the left edge.
    stages.forEach((stage, stageIndex) => {
      place(el("div", "story-board-swimlane-header story-board-swimlane-header-stage", stage), 1, 2 + stageIndex);
    });
    place(
      createIconButton({
        icon: "tabler:plus",
        label: "Add stage",
        kind: "compact",
        onClick: () => {
          const name = window.prompt("New stage name");
          if (name && name.trim()) applyMutation(withStages([...currentModel.stages, name.trim()]));
        },
      }),
      1,
      totalCols
    );

    lanes.forEach((lane, laneIndex) => {
      const row = 2 + laneIndex;
      place(el("div", "story-board-swimlane-header story-board-swimlane-header-lane", lane), row, 1);
      stages.forEach((stage, stageIndex) => {
        const cell = el("div", "story-board-swimlane-cell d-flex flex-column gap-1");
        cell.dataset.lane = lane;
        cell.dataset.stage = stage;
        currentModel.nodes
          .filter((node) => (node.lane || "(No lane)") === lane && (node.stage || "(No stage)") === stage)
          .forEach((node) => {
            const card = buildNodeCard(node);
            card.addEventListener("click", () => {
              selectedNodeId = node.id;
              render();
            });
            cell.appendChild(card);
          });
        place(cell, row, 2 + stageIndex);
      });
      filler(row, totalCols);
    });

    place(
      createIconButton({
        icon: "tabler:plus",
        label: "Add lane",
        kind: "compact",
        onClick: () => {
          const name = window.prompt("New lane name");
          if (name && name.trim()) applyMutation(withLanes([...currentModel.lanes, name.trim()]));
        },
      }),
      totalRows,
      1
    );
    stages.forEach((stage, stageIndex) => filler(totalRows, 2 + stageIndex));
    filler(totalRows, totalCols);

    host.appendChild(grid);
  }

  // --- Node inspector ---------------------------------------------------
  function renderInspector(host) {
    const node = selectedNodeId ? findNode(selectedNodeId) : null;
    if (!node) {
      host.appendChild(el("p", "text-body-secondary small mb-0", "Select a node to edit it, or Add Node to create one."));
      return;
    }
    const wrap = el("div", "d-flex flex-column gap-2");

    // Title + Remove Node share the top row now (an icon button, top-right)
    // instead of a full-width "Remove node" button previously sitting at
    // the very bottom of the whole panel, disconnected from the node it
    // acts on.
    const titleRow = el("div", "d-flex align-items-center gap-2");
    titleRow.appendChild(el("div", "fw-semibold text-truncate flex-grow-1", node.id));
    const removeNodeButton = createIconButton({
      icon: "tabler:trash",
      label: "Remove node",
      variant: "outline-danger",
      kind: "compact",
      onClick: () => {
        applyMutation(withRemovedNode(node.id));
        selectedNodeId = null;
        render();
      },
    });
    titleRow.appendChild(removeNodeButton);
    wrap.appendChild(titleRow);

    const refField = createFormFloatingField({ type: "text", id: domIdFor("sb-ref", node.id), label: "Reference (kind:Name)", value: node.ref || "" });
    const refInput = refField.querySelector("input");
    refInput.placeholder = "e.g. npc:Maris Wavedeep — blank for a placeholder";
    refInput.addEventListener("change", () => {
      const ref = refInput.value.trim();
      applyMutation(withNodeField(node.id, { ref, type: ref ? "ref" : "placeholder" }));
    });
    wrap.appendChild(refField);

    if (typeof openRefPicker === "function") {
      const promoteButton = el("button", "btn btn-sm btn-outline-primary", node.type === "ref" ? "Change reference" : "Promote to real content");
      promoteButton.type = "button";
      promoteButton.addEventListener("click", async () => {
        const ref = await openRefPicker();
        if (!ref) return;
        applyMutation(withNodeField(node.id, { ref, type: "ref" }));
      });
      wrap.appendChild(promoteButton);
    }

    const colorField = createFormFloatingField({
      type: "select",
      id: domIdFor("sb-color", node.id),
      label: "Color",
      options: [
        { value: "", label: "Default" },
        { value: "blue", label: "Blue" },
        { value: "teal", label: "Teal" },
        { value: "green", label: "Green" },
        { value: "orange", label: "Orange" },
        { value: "red", label: "Red" },
        { value: "purple", label: "Purple" },
      ],
    });
    const colorSelect = colorField.querySelector("select");
    colorSelect.value = node.color || "";
    colorSelect.addEventListener("change", () => applyMutation(withNodeField(node.id, { color: colorSelect.value })));
    wrap.appendChild(colorField);

    if (currentModel.layoutMode === "swimlane") {
      const laneField = createFormFloatingField({
        type: "select",
        id: domIdFor("sb-lane", node.id),
        label: "Lane",
        options: [{ value: "", label: "(No lane)" }, ...currentModel.lanes.map((lane) => ({ value: lane, label: lane }))],
      });
      const laneSelect = laneField.querySelector("select");
      laneSelect.value = node.lane || "";
      laneSelect.addEventListener("change", () => applyMutation(withNodeField(node.id, { lane: laneSelect.value })));
      wrap.appendChild(laneField);

      const stageField = createFormFloatingField({
        type: "select",
        id: domIdFor("sb-stage", node.id),
        label: "Stage",
        options: [{ value: "", label: "(No stage)" }, ...currentModel.stages.map((stage) => ({ value: stage, label: stage }))],
      });
      const stageSelect = stageField.querySelector("select");
      stageSelect.value = node.stage || "";
      stageSelect.addEventListener("change", () => applyMutation(withNodeField(node.id, { stage: stageSelect.value })));
      wrap.appendChild(stageField);
    }

    wrap.appendChild(el("hr", "my-1"));
    wrap.appendChild(el("div", "small text-body-secondary fw-semibold", "Connect to…"));
    const connectRow = el("div", "d-flex gap-2");
    const targetSelect = document.createElement("select");
    targetSelect.className = "form-select form-select-sm";
    currentModel.nodes
      .filter((candidate) => candidate.id !== node.id)
      .forEach((candidate) => {
        const option = document.createElement("option");
        option.value = candidate.id;
        option.textContent = candidate.id;
        targetSelect.appendChild(option);
      });
    connectRow.appendChild(targetSelect);
    const connectButton = createIconButton({
      icon: "tabler:plus",
      label: "Add edge",
      kind: "compact",
      onClick: () => {
        if (!targetSelect.value) return;
        applyMutation(withNewEdge({ from: node.id, to: targetSelect.value, label: "" }));
      },
    });
    connectRow.appendChild(connectButton);
    wrap.appendChild(connectRow);

    const touchingEdges = currentModel.edges
      .map((edge, index) => ({ edge, index }))
      .filter(({ edge }) => edge.from === node.id || edge.to === node.id);
    if (touchingEdges.length) {
      const edgeList = el("div", "d-flex flex-column gap-1");
      touchingEdges.forEach(({ edge, index }) => {
        const row = el("div", "d-flex align-items-center justify-content-between small gap-1");
        const other = edge.from === node.id ? edge.to : edge.from;
        row.appendChild(el("span", "text-truncate", `${edge.from === node.id ? "→" : "←"} ${other}${edge.label ? ` (${edge.label})` : ""}`));
        const removeButton = createIconButton({
          icon: "tabler:x",
          label: "Remove connection",
          variant: "outline-danger",
          kind: "compact",
          onClick: () => applyMutation(withRemovedEdge(index)),
        });
        row.appendChild(removeButton);
        edgeList.appendChild(row);
      });
      wrap.appendChild(edgeList);
    }

    host.appendChild(wrap);
  }

  function render() {
    if (destroyed) return;
    // Disposed before the wipe, not just left to be garbage-collected — a
    // Bootstrap tooltip's own popup is a sibling appended to <body> (via
    // Popper), not inside the trigger element, so wiping the trigger out
    // via innerHTML = "" without disposing it first leaves that popup
    // orphaned on <body> forever (Bootstrap's own mouseleave cleanup can
    // never run for a trigger that no longer exists) — same "stuck
    // tooltip" failure mode already fixed this way in dashboard.js's own
    // toolbar rebuild and audio-recorder.js's own render().
    disposeTooltips(container);
    container.innerHTML = "";
    if (modeSlot) {
      disposeTooltips(modeSlot);
      modeSlot.innerHTML = "";
      modeSlot.appendChild(renderLayoutModeToggle());
      refreshTooltips(modeSlot);
    }
    const body = el("div", "d-flex gap-3");
    body.style.minHeight = "0";
    // The toolbar (Add Node included) lives INSIDE this column, sized to
    // the stage/grid's own width rather than the full card — so Add Node,
    // pushed to this row's own right edge, lands above the node canvas
    // itself, not above the inspector panel beside it.
    const stageColumn = el("div", "d-flex flex-column flex-grow-1");
    stageColumn.style.minHeight = "24rem";
    stageColumn.appendChild(renderToolbar());
    const stageHost = el("div", "flex-grow-1");
    stageHost.style.minHeight = "0";
    if (currentModel.layoutMode === "swimlane") renderSwimlane(stageHost);
    else renderFreeform(stageHost);
    stageColumn.appendChild(stageHost);
    body.appendChild(stageColumn);
    const inspectorHost = el("div", "story-board-inspector flex-shrink-0");
    renderInspector(inspectorHost);
    body.appendChild(inspectorHost);
    container.appendChild(body);
    // Every element here is freshly rebuilt this render — re-scans and
    // initializes tooltips fresh each time rather than assuming Bootstrap's
    // own instances survive a full DOM replacement, which they don't.
    refreshTooltips(container);
  }

  render();

  return {
    // The caller re-parses the persisted page body after every save
    // (updateStoryBoardInPage's own return) and hands the fresh model back
    // here — this never re-derives it from its own local state, so a
    // concurrent edit elsewhere (another tab, another GM) is never
    // silently clobbered by a stale local copy.
    update(nextModel) {
      currentModel = nextModel || currentModel;
      render();
    },
    destroy() {
      destroyed = true;
      panZoom?.destroy();
      disposeTooltips(container);
      container.innerHTML = "";
      // modeSlot lives in markdown.js's own rendered DOM, not inside
      // `container` — this module still owns whatever it mounted there, so
      // it cleans that up itself rather than leaving an orphaned toggle
      // (and a stuck tooltip) behind once this story board's own
      // .callout-content is torn down or re-rendered.
      if (modeSlot) {
        disposeTooltips(modeSlot);
        modeSlot.innerHTML = "";
      }
    },
  };
}
