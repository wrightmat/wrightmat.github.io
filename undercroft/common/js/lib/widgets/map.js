// A locked-down, sidebar-free viewer for a saved Map — the "player/table"
// half of Orrery's own pan/zoom/layer-rendering surface. Reuses
// BaseMapManager (orrery/js/lib/base-maps.js) for the actual base map +
// pan/zoom, and orrery/js/lib/map-viewer.js's renderMapLayers — the exact
// same top-level render loop Orrery's own app.js now also calls — so every
// layer type (grid, raster, vector, marker) a map has renders identically
// here, not just markers. Nothing in this file is a parallel reimplementation
// of Orrery's own rendering.
//
// This widget passes no `selection`/`activeGroup`/interactive callbacks to
// renderMapLayers, which is the whole opt-out mechanism — Orrery-only
// concerns (grid-cell click-selection, "click empty space to place a new
// marker," whole-layer drag, undo-stack recording) simply never run when
// those options are absent. The interactive affordances this widget DOES
// supply (drag a character marker you own, open/close a door) come from
// map-viewer.js's own buildRestrictedMapOptions — the exact same policy
// Orrery's own app.js uses for a non-owner viewer reaching Orrery directly.
// This widget is ALWAYS that restricted view (a player's dashboard never
// gets full authoring), which is why it always builds those options, never
// the full-access ones. NOT gated on the dashboard's separate "pinned
// character" concept at all — that's a different feature (which character a
// widget like Character Summary/Combat Tracker is currently showing), and
// previously, incorrectly, gated dragging here too: a player who owned a
// character but hadn't explicitly pinned it via the Character Summary
// widget saw zero drag controls for their own token, confirmed real bug.
import { BaseMapManager } from "../../../../orrery/js/lib/base-maps.js";
import {
  renderMapLayers,
  createPingMarker,
  buildRestrictedMapOptions,
  resolveClickPosition,
  getGridCellSize,
  markerPositionToLocalPixel,
  renderShapeElement,
  resolveMarkerLinkTarget,
} from "../../../../orrery/js/lib/map-viewer.js";
import {
  createVectorPathElement,
  createVectorShapeElement,
  createMarkerOverlayIcon,
  AOE_SHAPE_TYPES,
} from "../../../../orrery/js/lib/map-model.js";
import { resolveToolHref, resolveToolContextPath } from "../app-shell.js";
import { resolveIsSpotlighted } from "../spotlight.js";
import { createCharacterOwnershipPrimer, matchesOwner, refreshOwnershipCatalog } from "../ownership.js";
import { el } from "../dom.js";
import { getIconTokens } from "../icon-picker.js";
// Same icon-picker/overlay-icon shape Orrery's own marker inspector uses for
// a token's badge icons — reused as-is rather than a second, player-scoped
// copy. No image field here on purpose — a player can recolor/re-icon their
// own token, not replace its portrait.
import { createIconPickerField } from "../ui-components.js";
import {
  watchMapForChanges,
  persistMarkerMove as persistMarkerMoveShared,
  persistElementUpdate,
  persistPlayerDrawing,
  removeElement,
} from "../map-live-sync.js";

// 10s (was 30s) — same reasoning as combat-tracker.js's own
// POLL_INTERVAL_MS, kept a bit more conservative here since a map's own
// content (layers/markers) typically changes less often mid-session than
// combat or a clock does.
const POLL_INTERVAL_MS = 10000;

export function initMapWidget(
  container,
  {
    dataManager,
    status,
    contentRef,
    groupId = "",
    shareToken = "",
    viewerTier = "free",
    onTitleChange,
    setHeaderAction,
    setRightAction,
    canToggleVisibility = false,
    editing = false,
  } = {}
) {
  const mapId = contentRef?.id;
  if (!container || !dataManager || !mapId) {
    return { destroy() {} };
  }

  // mapId/shareToken are fixed for this widget instance's whole lifetime (a
  // new map means a new instance, not a change to this one — see Card's own
  // comment on contentRef), so unlike the map's own name (only known once
  // `load()` fetches it, see onTitleChange below) this can be set once, right
  // away, rather than re-derived on every poll.
  const orreryParams = new URLSearchParams({ map: mapId });
  if (shareToken) orreryParams.set("share", shareToken);
  setHeaderAction?.({
    icon: "tabler:external-link",
    tooltip: "Open in Orrery",
    href: `${resolveToolHref("orrery", resolveToolContextPath())}?${orreryParams.toString()}`,
  });

  let destroyed = false;
  let map = null;
  let baseMapSignature = "";
  let baseMapManager = null;
  let zoomPanel = null;
  let watcher = null;
  let visible = false;
  // Set true for the duration of a marker drag (buildRestrictedMapOptions'
  // own onDragStateChange) — onMapChanged below skips an incoming poll/
  // live-stream update while this is true, so it can't rebuild the marker
  // layer's DOM (and tear out the very dot element being dragged) mid-
  // gesture. See that function's own comment for the confirmed "drag pops
  // straight to the final position instead of tracking the cursor" bug this
  // fixes.
  let isDraggingMarker = false;

  // Player toolbar tool state — instance-scoped (not local to
  // buildZoomPanel) since the panel itself gets rebuilt whenever the base
  // map changes (onMapChanged's own zoomPanel = null reset); a tool a
  // viewer already had armed shouldn't silently disarm just because an
  // unrelated base-map edit landed. One at a time, unlike Orrery's own
  // independent per-tool booleans — a GM's own toolbar never enforced
  // mutual exclusion either, but a player toolbar with two tools armed at
  // once (a click ambiguously either pings or starts measuring) is a worse
  // experience for less benefit, and costs nothing extra to prevent here.
  let activeTool = null; // null | "ping" | "measure" | "draw" | "shape"

  // One shared "pencil color" for both Draw and Shape (a shape's fillColor
  // AND strokeColor both come from this single value — there's no separate
  // "outline" concept, a drawn path/shape only ever has one visible color)
  // — matching Orrery's own identical drawColor concept (orrery/js/app.js),
  // rather than each tool hardcoding its own default. Instance-scoped, same
  // "survives a zoomPanel rebuild" reasoning as activeTool above.
  let drawColor = "#0f172a";

  // Same primary-grid-layer/scale-unit math as Orrery's own
  // findPrimaryGridLayer/pixelsToCells/hasMapMeasurementConfigured
  // (app.js) — small enough, and app.js isn't a shared lib module other
  // files import from, that porting the algorithm here directly is more
  // appropriate than reaching into Orrery's own page script.
  function findPrimaryGridLayer() {
    return (map?.layers || []).find((entry) => entry.type === "grid") || null;
  }
  function pixelsToCells(pixelDistance) {
    const gridLayer = findPrimaryGridLayer();
    if (!gridLayer) return null;
    const cellSizePx = getGridCellSize(baseMapManager, map, gridLayer);
    if (!cellSizePx) return null;
    return pixelDistance / cellSizePx;
  }
  function hasMapMeasurementConfigured() {
    return Number.isFinite(map?.measurement?.scale) && map.measurement.scale > 0 && Boolean(map?.measurement?.unit);
  }

  // AoE shape sizes generally fall in whole real-world-unit increments —
  // identical to Orrery's own snapCellsToWholeUnit (app.js). No-op if the
  // map has no usable scale to round against.
  function snapCellsToWholeUnit(cells) {
    const scale = map?.measurement?.scale;
    if (!Number.isFinite(scale) || scale <= 0) return cells;
    return Math.round(cells * scale) / scale;
  }

  // Rebuilt fresh by buildZoomPanel every time the base map changes — these
  // `let`s (not consts captured once) are what let the persistent
  // viewerHost-level pointerdown handler below always read the CURRENT
  // buttons/readouts, not stale ones from a since-discarded panel.
  let pingButtonEl = null;
  let measureButtonEl = null;
  let measureReadoutEl = null;
  let drawButtonEl = null;
  let shapeButtonEl = null;
  let shapeTypeSelectEl = null;
  let shapeReadoutEl = null;
  let drawColorInputEl = null;

  function setMeasureReadout(text) {
    if (!measureReadoutEl) return;
    measureReadoutEl.textContent = text || "";
    measureReadoutEl.classList.toggle("d-none", !text);
  }
  function setShapeReadout(text) {
    if (!shapeReadoutEl) return;
    shapeReadoutEl.textContent = text || "";
    shapeReadoutEl.classList.toggle("d-none", !text);
  }

  // One at a time (see activeTool's own declaration comment) — clicking an
  // already-active tool's button disarms it, matching every toggle button
  // elsewhere in this suite.
  function setActiveTool(tool) {
    activeTool = activeTool === tool ? null : tool;
    pingButtonEl?.classList.toggle("active", activeTool === "ping");
    pingButtonEl?.setAttribute("aria-pressed", activeTool === "ping" ? "true" : "false");
    measureButtonEl?.classList.toggle("active", activeTool === "measure");
    measureButtonEl?.setAttribute("aria-pressed", activeTool === "measure" ? "true" : "false");
    drawButtonEl?.classList.toggle("active", activeTool === "draw");
    drawButtonEl?.setAttribute("aria-pressed", activeTool === "draw" ? "true" : "false");
    shapeButtonEl?.classList.toggle("active", activeTool === "shape");
    shapeButtonEl?.setAttribute("aria-pressed", activeTool === "shape" ? "true" : "false");
    shapeTypeSelectEl?.classList.toggle("d-none", activeTool !== "shape");
    // Same "only show a tool's own contextual control while it's active"
    // rule as the Shape Type select just above — Draw and Shape share this
    // one swatch (see drawColor's own declaration comment).
    drawColorInputEl?.classList.toggle("d-none", activeTool !== "draw" && activeTool !== "shape");
    if (activeTool !== "measure") setMeasureReadout("");
    if (activeTool !== "shape") setShapeReadout("");
    // Crosshair cursor while Draw/Shape/Measure is armed — same cursor,
    // same tools, as Orrery's own toolbar (orrery/css/styles.css's
    // [data-map-tool-active] rules, scoped this way since viewerHost
    // deliberately doesn't carry Orrery's own .orrery-map class).
    if (activeTool) {
      viewerHost.dataset.mapToolActive = activeTool;
    } else {
      delete viewerHost.dataset.mapToolActive;
    }
  }

  // Called on every buildZoomPanel AND every onMapChanged (not just when the
  // panel itself gets rebuilt) — a GM configuring Scale/Unit mid-session
  // shouldn't leave Measure/Shape stuck disabled until some unrelated
  // base-map edit happens to rebuild the panel.
  function refreshToolAvailability() {
    const configured = hasMapMeasurementConfigured();
    if (measureButtonEl) {
      measureButtonEl.disabled = !configured;
      measureButtonEl.title = configured ? "Measure distance" : "Ask the GM to set a map scale to enable measuring";
    }
    if (shapeButtonEl) {
      shapeButtonEl.disabled = !configured;
      shapeButtonEl.title = configured ? "Draw an AoE shape" : "Ask the GM to set a map scale to enable AoE shapes";
    }
    if (!configured && (activeTool === "measure" || activeTool === "shape")) {
      setActiveTool(activeTool);
    }
  }

  // Screen-pixel distance -> "X ft (Y cells)" — identical math to Orrery's
  // own formatDistance (app.js), just reading this widget's own `map`.
  function formatMeasuredDistance(pixelDistance) {
    const cells = pixelsToCells(pixelDistance);
    if (cells === null) return "No grid layer to measure against.";
    const distance = cells * map.measurement.scale;
    return `${distance.toFixed(1)} ${map.measurement.unit} (${cells.toFixed(1)} cells)`;
  }

  // A screen-space (position: fixed) ruler line, appended to <body> rather
  // than the map overlay — identical to Orrery's own createMeasureLine,
  // reusing its exact `.orrery-measure-line-overlay` CSS class (already
  // loaded on this page).
  function createMeasureLine(startX, startY) {
    const svg = document.createElementNS("http://www.w3.org/2000/svg", "svg");
    svg.setAttribute("class", "orrery-measure-line-overlay");
    const line = document.createElementNS("http://www.w3.org/2000/svg", "line");
    line.setAttribute("x1", String(startX));
    line.setAttribute("y1", String(startY));
    line.setAttribute("x2", String(startX));
    line.setAttribute("y2", String(startY));
    svg.appendChild(line);
    const startDot = document.createElementNS("http://www.w3.org/2000/svg", "circle");
    startDot.setAttribute("cx", String(startX));
    startDot.setAttribute("cy", String(startY));
    startDot.setAttribute("r", "4");
    svg.appendChild(startDot);
    document.body.appendChild(svg);
    return {
      update(endX, endY) {
        line.setAttribute("x2", String(endX));
        line.setAttribute("y2", String(endY));
      },
      remove() {
        svg.remove();
      },
    };
  }

  // Fetch-fresh/append/save, same immediacy as a marker move — this widget
  // has no Save button/local-dirty-state concept at all. Resolves (creating
  // if needed) an ordinary vector layer itself, so this widget never needs
  // to know or track that layer's id.
  async function persistDrawing(element) {
    try {
      const freshMap = await persistPlayerDrawing({ dataManager, mapId, shareToken, element });
      if (!freshMap) return;
      map = freshMap;
      watcher?.noteLocalWrite();
      renderLayers();
    } catch (error) {
      status?.show(error.message || "Unable to save your drawing.", { type: "error" });
    }
  }

  // Tags a player-placed path/shape with who drew it (id first, username as
  // a fallback — same two-step match ownership.js's own matchesOwner uses
  // for every other kind of record in the suite) — `createVectorPathElement`/
  // `createVectorShapeElement` don't declare these fields, but nothing stops
  // a plain extra property on the returned object.
  function tagAsOwnDrawing(element) {
    element.authorId = dataManager.session?.user?.id ?? null;
    element.authorUsername = dataManager.session?.user?.username || "";
    return element;
  }
  function isOwnDrawing(element) {
    const userId = dataManager.session?.user?.id;
    const username = dataManager.session?.user?.username;
    if (userId != null && element.authorId === userId) return true;
    return Boolean(username) && element.authorUsername === username;
  }

  // The map's OWN owner (the GM, in the common case) can also manage any
  // player's drawing/shape, not just their own — fetched once via the same
  // generic ownership.js helper every other kind of record's owner-check
  // already uses (kind-agnostic: `map` works exactly like `character`
  // does). Deliberately matchesOwner()/admin-tier ONLY, not allowsDelete()'s
  // broader "or an edit-permission share" rule — every campaign member
  // already holds an edit share on a spotlighted map (that's what lets
  // players save their OWN marker moves/drawings at all), so allowsDelete()
  // would let any player manage any other player's drawing too, not just
  // the GM. Confirmed real bug this fixes: a GM viewing this same widget
  // (not full Orrery) couldn't drag/delete a player-authored shape at all.
  let mapOwnerMetadata = null;
  async function loadMapOwnership() {
    const catalog = await refreshOwnershipCatalog(dataManager, "map", [mapId]);
    mapOwnerMetadata = catalog.get(mapId) || null;
  }
  void loadMapOwnership();
  function isMapOwnerOrAdmin() {
    if (dataManager.getUserTier?.() === "admin") return true;
    if (!mapOwnerMetadata) return false;
    if (mapOwnerMetadata.ownership === "local") return true;
    return matchesOwner(mapOwnerMetadata, { session: dataManager.session });
  }
  function canManageDrawing(element) {
    return isOwnDrawing(element) || isMapOwnerOrAdmin();
  }

  // Fetch-fresh/filter-out/save — a player deleting their own drawing.
  async function removeDrawing(layer, elementId) {
    try {
      const freshMap = await removeElement({ dataManager, mapId, shareToken, layerId: layer.id, elementId });
      if (!freshMap) return;
      map = freshMap;
      watcher?.noteLocalWrite();
      renderLayers();
    } catch (error) {
      status?.show(error.message || "Unable to delete that.", { type: "error" });
    }
  }

  // One color swatch (no separate "outline" concept — a drawing/shape has
  // just one visible color, same drawColor unification the toolbar's own
  // picker follows) + (shapes only) opacity, plus a small red × to delete —
  // anchored BELOW the actual clicked shape/path (event.target is the
  // invisible "hit" element map-viewer.js draws directly over the visible
  // geometry, so its own bounding rect matches what's on screen), same
  // below-anchor idiom openMarkerEditor already uses off its own dotEl.
  // Confirmed real complaint with the older click-point anchor (event.
  // clientX/Y directly): it landed the popover square on top of whatever
  // was just clicked, which for a shape is typically its own visible
  // center — right where you'd want to actually SEE it while editing.
  // Explicit `width` below is load-bearing, not cosmetic: `.orrery-floating-
  // panel` also sets `right: 1.5rem` (its own default corner-docked
  // position) — leaving width unset alongside an explicit `left` here made
  // the browser stretch the box to fill the whole gap between them, which
  // is why this used to render as a huge, nearly page-wide bar instead of a
  // small popover.
  function openDrawingEditor(layer, element, event) {
    closeMarkerEditor();
    const popover = el("div", "orrery-floating-panel d-flex flex-column gap-1 p-1");
    popover.style.position = "fixed";
    popover.style.width = "4.5rem";
    popover.style.zIndex = "1040";
    const hostRect = viewerHost.getBoundingClientRect();
    const targetRect = event?.target?.getBoundingClientRect?.();
    const top = targetRect ? targetRect.bottom + 4 : (event?.clientY ?? hostRect.top) + 4;
    const left = targetRect ? targetRect.left : (event?.clientX ?? hostRect.left) - 24;
    popover.style.top = `${top}px`;
    popover.style.left = `${Math.max(hostRect.left + 4, Math.min(left, hostRect.right - 76))}px`;

    const colorInput = document.createElement("input");
    colorInput.type = "color";
    colorInput.className = "form-control form-control-color p-0";
    colorInput.style.width = "1.5rem";
    colorInput.style.height = "1.5rem";
    colorInput.style.flexShrink = "0";
    colorInput.title = "Color";
    colorInput.setAttribute("aria-label", "Color");
    colorInput.value = element.strokeColor || element.fillColor || "#0f172a";
    colorInput.addEventListener("change", () => {
      // A shape's fillColor and strokeColor stay locked together (one
      // shared color, see drawColor's own declaration comment); a path has
      // no meaningful fillColor to update at all.
      const patch =
        element.kind === "shape"
          ? { strokeColor: colorInput.value, fillColor: colorInput.value }
          : { strokeColor: colorInput.value };
      void persistElementFields(layer, element.id, patch);
    });

    const topRow = el("div", "d-flex align-items-center gap-1");
    topRow.appendChild(colorInput);

    const deleteButton = document.createElement("button");
    deleteButton.type = "button";
    deleteButton.className = "btn btn-outline-danger btn-sm ms-auto d-inline-flex align-items-center justify-content-center p-0 lh-1";
    deleteButton.style.width = "1.5rem";
    deleteButton.style.height = "1.5rem";
    deleteButton.style.flexShrink = "0";
    deleteButton.title = "Delete";
    deleteButton.setAttribute("aria-label", "Delete");
    deleteButton.textContent = "×";
    deleteButton.addEventListener("click", () => {
      closeMarkerEditor();
      void removeDrawing(layer, element.id);
    });
    topRow.appendChild(deleteButton);
    popover.appendChild(topRow);

    // Opacity only exists on a shape's own data (createVectorShapeElement) —
    // a drawn path has no such field, same as Orrery's own inspector never
    // shows one for a path either.
    if (element.kind === "shape") {
      const opacityInput = document.createElement("input");
      opacityInput.type = "range";
      opacityInput.className = "form-range";
      opacityInput.min = "0";
      opacityInput.max = "1";
      opacityInput.step = "0.05";
      opacityInput.title = "Opacity";
      opacityInput.setAttribute("aria-label", "Opacity");
      opacityInput.value = Number.isFinite(element.opacity) ? element.opacity : 0.5;
      opacityInput.addEventListener("change", () => {
        void persistElementField(layer, element.id, "opacity", Number(opacityInput.value));
      });
      popover.appendChild(opacityInput);
    }

    viewerHost.appendChild(popover);
    markerEditorPopover = popover;
    document.addEventListener("pointerdown", onOutsidePointerDown, true);
  }

  // One persistent listener on viewerHost (never rebuilt, unlike zoomPanel)
  // covering every tool — mirrors Orrery's own mapContainer-level
  // pointerdown listeners for these exact four tools. A marker's own dot
  // already calls stopPropagation() on its pointerdown (map-viewer.js's
  // createMarkerDot), so dragging/clicking a token never reaches this
  // handler at all — no conflict between the two.
  function handleToolPointerDown(event) {
    if (event.button !== 0 || !baseMapManager || !map) return;
    if (activeTool === "ping") {
      if (!groupId) {
        status?.show("No active campaign to ping in.", { type: "warning", timeout: 2500 });
        return;
      }
      const overlay = baseMapManager.getOverlayContainer();
      if (!overlay) return;
      const position = resolveClickPosition(baseMapManager, map, event, overlay);
      if (!position) return;
      // Rendered locally right away, same reasoning as Orrery's own
      // setupPingTool — the full SSE round-trip is a lot of links to depend
      // on for feedback on your OWN click.
      overlay.appendChild(createPingMarker(baseMapManager, map, position, dataManager.session?.user?.username || "You"));
      void dataManager.postMapPing({ groupId, position }).catch((error) => {
        status?.show(error.message || "Unable to send ping.", { type: "error", timeout: 3000 });
      });
      return;
    }
    if (activeTool === "measure") {
      event.preventDefault();
      baseMapManager.setInteractionEnabled(false);
      const startX = event.clientX;
      const startY = event.clientY;
      const measureLine = createMeasureLine(startX, startY);
      const onMove = (moveEvent) => {
        const dx = moveEvent.clientX - startX;
        const dy = moveEvent.clientY - startY;
        measureLine.update(moveEvent.clientX, moveEvent.clientY);
        setMeasureReadout(formatMeasuredDistance(Math.hypot(dx, dy)));
      };
      const onUp = () => {
        baseMapManager.setInteractionEnabled(true);
        measureLine.remove();
        window.removeEventListener("pointermove", onMove);
        window.removeEventListener("pointerup", onUp);
      };
      window.addEventListener("pointermove", onMove);
      window.addEventListener("pointerup", onUp);
      return;
    }
    if (activeTool === "draw") {
      event.preventDefault();
      baseMapManager.setInteractionEnabled(false);
      const overlay = baseMapManager.getOverlayContainer();
      const points = [];
      const preview = document.createElementNS("http://www.w3.org/2000/svg", "svg");
      preview.style.position = "absolute";
      preview.style.inset = "0";
      preview.style.width = "100%";
      preview.style.height = "100%";
      preview.style.overflow = "visible";
      preview.style.pointerEvents = "none";
      const polyline = document.createElementNS("http://www.w3.org/2000/svg", "polyline");
      polyline.setAttribute("fill", "none");
      polyline.setAttribute("stroke", drawColor);
      polyline.setAttribute("stroke-width", "2");
      polyline.setAttribute("stroke-linecap", "round");
      polyline.setAttribute("stroke-linejoin", "round");
      preview.appendChild(polyline);
      overlay.appendChild(preview);
      const addPoint = (pointerEvent) => {
        const position = resolveClickPosition(baseMapManager, map, pointerEvent, overlay);
        if (!position) return;
        points.push(position);
        const pixelPoints = points.map((point) => markerPositionToLocalPixel(baseMapManager, map, point));
        polyline.setAttribute("points", pixelPoints.map((point) => `${point.x},${point.y}`).join(" "));
      };
      addPoint(event);
      const onMove = (moveEvent) => addPoint(moveEvent);
      const onUp = () => {
        window.removeEventListener("pointermove", onMove);
        window.removeEventListener("pointerup", onUp);
        baseMapManager.setInteractionEnabled(true);
        preview.remove();
        if (points.length > 1) {
          void persistDrawing(tagAsOwnDrawing(createVectorPathElement({ points, strokeColor: drawColor })));
          // Single-shot — placing one stroke disarms the tool, same as
          // Shape below, rather than staying armed for another click to
          // immediately start a second one with no way to just stop.
          setActiveTool("draw");
        }
      };
      window.addEventListener("pointermove", onMove);
      window.addEventListener("pointerup", onUp);
      return;
    }
    if (activeTool === "shape") {
      event.preventDefault();
      baseMapManager.setInteractionEnabled(false);
      const overlay = baseMapManager.getOverlayContainer();
      const origin = resolveClickPosition(baseMapManager, map, event, overlay);
      if (!origin) {
        baseMapManager.setInteractionEnabled(true);
        return;
      }
      const shapeType = AOE_SHAPE_TYPES.includes(shapeTypeSelectEl?.value) ? shapeTypeSelectEl.value : "circle";
      const startClientX = event.clientX;
      const startClientY = event.clientY;
      // No target layer yet (the target vector layer only gets resolved/
      // created server-side, at commit time, by persistPlayerDrawing) —
      // getMarkerLayerOffset needs SOME layer shape to read a position
      // offset from, but every vector layer's own default position is
      // {x:0,y:0} (map-model.js's createLayer) and nothing here ever lets a
      // player author a layer with a non-zero one, so a plain zero offset is
      // exactly as correct as fetching the real (also-zero) layer would be.
      const offset = { x: 0, y: 0 };
      const preview = document.createElementNS("http://www.w3.org/2000/svg", "svg");
      preview.style.position = "absolute";
      preview.style.inset = "0";
      preview.style.width = "100%";
      preview.style.height = "100%";
      preview.style.overflow = "visible";
      preview.style.pointerEvents = "none";
      overlay.appendChild(preview);
      let sizeCells = 0;
      let angleDeg = 0;
      // One shared color for fill AND stroke (drawColor — see its own
      // declaration comment): a shape has no separate "outline" concept.
      // Not read from any layer's own settings — renderShapeElement's own
      // `layer` parameter is never actually referenced inside it (confirmed
      // by reading it: every stroke/fill/width comes from the element
      // passed in, 4th argument), and a player-placed shape has no
      // "selected vector layer" to read defaults from in the first place
      // (unlike Orrery's own GM tool).
      const strokeColor = drawColor;
      const fillColor = drawColor;
      const strokeWidth = 2;
      function drawPreview() {
        preview.innerHTML = "";
        renderShapeElement(
          preview,
          baseMapManager,
          map,
          null,
          {
            id: "shape-preview",
            kind: "shape",
            shapeType,
            origin,
            sizeCells,
            angleDeg,
            spreadDeg: 53,
            widthCells: 1,
            strokeColor,
            fillColor,
            strokeWidth,
          },
          offset,
          {}
        );
      }
      drawPreview();
      const onMove = (moveEvent) => {
        const dx = moveEvent.clientX - startClientX;
        const dy = moveEvent.clientY - startClientY;
        const cells = pixelsToCells(Math.hypot(dx, dy));
        if (cells === null) {
          setShapeReadout("No grid layer to measure against.");
          sizeCells = 0;
          drawPreview();
          return;
        }
        sizeCells = snapCellsToWholeUnit(cells);
        angleDeg = (Math.atan2(dy, dx) * 180) / Math.PI;
        const distance = Math.round(sizeCells * map.measurement.scale);
        setShapeReadout(`${distance} ${map.measurement.unit} (${sizeCells.toFixed(1)} cells)`);
        drawPreview();
      };
      const onUp = () => {
        window.removeEventListener("pointermove", onMove);
        window.removeEventListener("pointerup", onUp);
        baseMapManager.setInteractionEnabled(true);
        preview.remove();
        setShapeReadout("");
        if (sizeCells > 0) {
          void persistDrawing(
            tagAsOwnDrawing(
              createVectorShapeElement({
                shapeType,
                origin,
                sizeCells,
                angleDeg,
                strokeColor,
                fillColor,
                strokeWidth,
              })
            )
          );
          // Single-shot — see the Draw tool's own identical comment above.
          setActiveTool("shape");
        }
      };
      window.addEventListener("pointermove", onMove);
      window.addEventListener("pointerup", onUp);
    }
  }

  // Same direct spotlightToGroup/clearSpotlight toggle Handout's own
  // visibility button uses — no modal, just an eye icon. `LINK_ONLY_KINDS`
  // already covers "map" (spotlight.js) since a map is a link back into
  // Orrery, not a rendered card, but the visibility CONCEPT — "is this
  // currently the thing shown to the table" — is identical either way.
  function updateVisibilityAction() {
    if (!canToggleVisibility) return;
    setRightAction?.({
      icon: visible ? "tabler:eye" : "tabler:eye-off",
      tooltip: visible ? "Showing to table — click to hide" : "Hidden from table — click to show",
      active: visible,
      onClick: () => void toggleVisibility(),
    });
  }

  async function refreshVisibility() {
    if (!canToggleVisibility || !groupId) {
      visible = false;
      return;
    }
    // Per-instance, not just per-kind — a second Map must stay
    // independently toggleable, see resolveIsSpotlighted's own comment.
    visible = await resolveIsSpotlighted(dataManager, { groupId, shareToken, kind: "map", id: mapId });
    updateVisibilityAction();
  }

  async function toggleVisibility() {
    if (!groupId) {
      status?.show("No active campaign to show this to.", { type: "warning", timeout: 2500 });
      return;
    }
    try {
      if (visible) {
        await dataManager.clearSpotlight({ groupId, kind: "map", id: mapId });
        status?.show("Stopped showing to the table.", { type: "success", timeout: 2000 });
      } else {
        await dataManager.spotlightToGroup({ groupId, contentType: "map", contentId: mapId });
        status?.show("Showing to the table.", { type: "success", timeout: 2000 });
      }
    } catch (error) {
      status?.show(error.message || "Unable to update visibility.", { type: "error" });
    }
    await refreshVisibility();
  }

  void refreshVisibility();

  // Shared shape for every player tool toggle below (Ping, Measure, Draw,
  // Shape) — same outline-secondary sizing as the zoom buttons, with the
  // .active/aria-pressed toggle-button convention Orrery's own toolbar
  // already uses for these exact tools.
  function createToolToggleButton({ icon, label }) {
    const button = el("button", "btn btn-outline-secondary");
    button.type = "button";
    button.setAttribute("aria-pressed", "false");
    button.setAttribute("aria-label", label);
    button.title = label;
    const iconEl = el("span", "iconify");
    iconEl.dataset.icon = icon;
    iconEl.setAttribute("aria-hidden", "true");
    button.appendChild(iconEl);
    return button;
  }

  // Same zoom in/out/reset controls as Orrery's own floating panel
  // (orrery/index.html's data-zoom-in/-out/-reset, wired in orrery/js/app.js
  // to these exact BaseMapManager methods), plus the Ping/Measure toggles
  // added alongside them below — just the compact cluster itself, not
  // Orrery's draggable/collapsible panel chrome, which has no room to mean
  // anything in an 18rem-tall widget. Hidden while the Dashboard is in edit
  // mode (data-map-zoom-panel — see dashboard.js's own applyEditingState)
  // so it doesn't clutter the layout-editing view.
  function buildZoomPanel() {
    // Reuses Orrery's own `.orrery-floating-panel` class (orrery/css/styles.css,
    // already loaded on this page) rather than a bare `.btn-group` — that
    // class is what actually gives Orrery's real zoom panel its opaque
    // background/border/padding, which a plain outline btn-group doesn't
    // have on its own (nothing but thin button borders, easy to lose against
    // map tiles). It also sets z-index: 1035, comfortably above Leaflet's own
    // panes (base-maps.js forces overlayPane to 650, and others climb from
    // there) — those are siblings in this same viewerHost stacking context,
    // so anything lower gets painted over regardless of DOM order.
    const panel = el("div", "orrery-floating-panel");
    panel.dataset.mapZoomPanel = "";
    // Tighter inset than Orrery's own 1.5rem default — this panel floats
    // over an 18rem-tall widget, not a full-page map.
    panel.style.top = "0.5rem";
    panel.style.right = "0.5rem";
    panel.style.padding = "0.375rem";
    panel.classList.toggle("d-none", editing);
    const buttonGroup = el("div", "btn-group btn-group-sm");
    buttonGroup.setAttribute("role", "group");
    buttonGroup.setAttribute("aria-label", "Map zoom controls");
    panel.appendChild(buttonGroup);
    const zoomOutButton = el("button", "btn btn-outline-secondary");
    zoomOutButton.type = "button";
    zoomOutButton.setAttribute("aria-label", "Zoom out");
    const zoomOutIcon = el("span", "iconify");
    zoomOutIcon.dataset.icon = "tabler:zoom-out";
    zoomOutIcon.setAttribute("aria-hidden", "true");
    zoomOutButton.appendChild(zoomOutIcon);
    zoomOutButton.addEventListener("click", () => baseMapManager?.zoomBy(-0.25));
    const zoomResetButton = el("button", "btn btn-outline-secondary", "Reset");
    zoomResetButton.type = "button";
    zoomResetButton.addEventListener("click", () => baseMapManager?.reset());
    const zoomInButton = el("button", "btn btn-outline-secondary");
    zoomInButton.type = "button";
    zoomInButton.setAttribute("aria-label", "Zoom in");
    const zoomInIcon = el("span", "iconify");
    zoomInIcon.dataset.icon = "tabler:zoom-in";
    zoomInIcon.setAttribute("aria-hidden", "true");
    zoomInButton.appendChild(zoomInIcon);
    zoomInButton.addEventListener("click", () => baseMapManager?.zoomBy(0.25));
    buttonGroup.append(zoomOutButton, zoomResetButton, zoomInButton);

    // Ping/Measure/Draw/Shape — same four tools, same icons/tooltips as
    // Orrery's own toolbar (index.html's data-ping-toggle/-measure-toggle/
    // -draw-toggle/-shape-toggle), just this widget's own compact
    // toggle-button shape above instead of Orrery's larger wrapped/
    // tooltipped span markup. One armed at a time — see setActiveTool.
    const toolGroup = el("div", "btn-group btn-group-sm mt-1");
    toolGroup.setAttribute("role", "group");
    toolGroup.setAttribute("aria-label", "Map tools");

    pingButtonEl = createToolToggleButton({ icon: "tabler:location", label: "Ping the map" });
    pingButtonEl.addEventListener("click", () => setActiveTool("ping"));

    measureButtonEl = createToolToggleButton({ icon: "tabler:ruler-2", label: "Measure distance" });
    measureButtonEl.addEventListener("click", () => {
      if (measureButtonEl.disabled) return;
      setActiveTool("measure");
    });

    drawButtonEl = createToolToggleButton({ icon: "tabler:pencil", label: "Draw" });
    drawButtonEl.addEventListener("click", () => setActiveTool("draw"));

    shapeButtonEl = createToolToggleButton({ icon: "tabler:target", label: "Draw an AoE shape" });
    shapeButtonEl.addEventListener("click", () => {
      if (shapeButtonEl.disabled) return;
      setActiveTool("shape");
    });

    toolGroup.append(pingButtonEl, measureButtonEl, drawButtonEl, shapeButtonEl);
    panel.appendChild(toolGroup);

    // Color swatch + Shape type, one row — the swatch shown while either
    // Draw or Shape is armed, the select only for Shape (see setActiveTool's
    // own toggles above), but grouped together in the DOM/layout regardless
    // so Shape's own picker always lands directly right of the color it'll
    // use, matching Orrery's own toolbar ordering (index.html).
    const toolOptionsRow = el("div", "d-flex align-items-center gap-1 mt-1");

    // Shared Draw/Shape color swatch — same drawColor concept as Orrery's
    // own toolbar (index.html's data-draw-color).
    drawColorInputEl = document.createElement("input");
    drawColorInputEl.type = "color";
    drawColorInputEl.className = "form-control form-control-color form-control-sm flex-shrink-0 p-1 d-none";
    drawColorInputEl.title = "Drawing color";
    drawColorInputEl.setAttribute("aria-label", "Drawing color");
    drawColorInputEl.value = drawColor;
    drawColorInputEl.addEventListener("input", () => {
      drawColor = drawColorInputEl.value;
    });
    toolOptionsRow.appendChild(drawColorInputEl);

    // AoE shape type — same 4 options as Orrery's own data-shape-type
    // select, shown only while the Shape tool is armed.
    shapeTypeSelectEl = document.createElement("select");
    shapeTypeSelectEl.className = "form-select form-select-sm flex-grow-1 d-none";
    shapeTypeSelectEl.setAttribute("aria-label", "AoE shape type");
    [
      ["circle", "Circle"],
      ["cone", "Cone"],
      ["line", "Line"],
      ["square", "Square"],
    ].forEach(([value, label]) => {
      const option = document.createElement("option");
      option.value = value;
      option.textContent = label;
      shapeTypeSelectEl.appendChild(option);
    });
    toolOptionsRow.appendChild(shapeTypeSelectEl);
    panel.appendChild(toolOptionsRow);

    measureReadoutEl = el("span", "small text-body-secondary d-block mt-1 d-none");
    panel.appendChild(measureReadoutEl);
    shapeReadoutEl = el("span", "small text-body-secondary d-block mt-1 d-none");
    panel.appendChild(shapeReadoutEl);

    // Re-apply whichever tool (if any) was already armed before this panel
    // got rebuilt — activeTool itself survives a rebuild (instance-scoped),
    // but the fresh buttons above all start unpressed until this runs.
    if (activeTool) {
      const armed = activeTool;
      activeTool = null;
      setActiveTool(armed);
    }
    refreshToolAvailability();

    return panel;
  }

  // Deliberately NOT the `.orrery-map` class — that rule is
  // `position: fixed; inset: 0`, meant for Orrery's own full-page host
  // element, and would blow this widget out to cover the whole viewport.
  // BaseMapManager only needs a normal positioned container with real
  // dimensions; it builds its own `.orrery-map-stage`/`.orrery-map-content`
  // children inside whatever's passed in (orrery/css/styles.css, loaded on
  // this page too, styles those).
  const viewerHost = el("div");
  viewerHost.style.position = "relative";
  viewerHost.style.width = "100%";
  // Always fills the widget's own mount point (a flex column sized to this
  // grid cell's own colSpan/rowSpan-driven footprint) in both dimensions,
  // not just in forcePlayerView — every card gets a real, resizable grid
  // cell now (dashboard.js's renderWidgetGrid), GM view included, so there's
  // no longer a context where a fixed fallback height makes sense; a fixed
  // 18rem here previously meant resizing a Map widget's grid cell taller
  // never actually grew the visible map (confirmed directly). Tracks live on
  // resize via plain CSS (the ResizeObserver below is still needed
  // separately, for Leaflet's own internal canvas — see its own comment).
  viewerHost.style.flex = "1 1 0";
  viewerHost.style.minHeight = "0";
  viewerHost.style.borderRadius = "0.5rem";
  viewerHost.style.overflow = "hidden";
  // Leaflet caches its container's pixel size at mount and doesn't notice a
  // CSS-only size change on its own (a well-known Leaflet gotcha) — without
  // this, resizing the grid cell (via the width/height steppers, or the
  // Widget Inspector pane narrowing/widening this same column in normal use)
  // would leave the map canvas at its stale original size, cut off or with
  // dead space around it.
  const resizeObserver =
    typeof ResizeObserver !== "undefined"
      ? new ResizeObserver(() => baseMapManager?.getMap?.()?.invalidateSize?.())
      : null;
  resizeObserver?.observe(viewerHost);
  // Registered once, on the persistent viewerHost — not inside
  // buildZoomPanel, which gets discarded/rebuilt whenever the base map
  // changes. See handleToolPointerDown's own comment for why this never
  // conflicts with marker dragging/clicking.
  viewerHost.addEventListener("pointerdown", handleToolPointerDown);

  function renderError(message) {
    container.innerHTML = "";
    container.appendChild(el("p", "text-danger small mb-0", message));
  }

  // Same synchronous, cache-backed lookup Orrery's own app.js keeps (see
  // that file's own header comment on why a live Vision Range Binding can't
  // just be fetched inline inside the synchronous render pipeline) — a
  // separate instance here since this widget has its own dataManager/
  // lifetime, but both ultimately resolve identically (map-viewer.js's own
  // resolveMarkerVisionRangeCells/resolveBinding), so a player's own fog
  // view matches the GM's.
  const characterPayloadCache = new Map();
  const pendingCharacterFetches = new Set();
  function getCachedCharacterPayload(refId) {
    return characterPayloadCache.get(refId);
  }
  function ensureCharacterPayloadCached(refId) {
    if (!refId || characterPayloadCache.has(refId) || pendingCharacterFetches.has(refId)) return;
    pendingCharacterFetches.add(refId);
    dataManager
      .get("character", refId)
      .then((result) => {
        characterPayloadCache.set(refId, result?.payload || {});
        pendingCharacterFetches.delete(refId);
        renderLayers();
      })
      .catch(() => {
        pendingCharacterFetches.delete(refId);
      });
  }

  // Ownership catalog for character markers actually placed on this map —
  // shared fetch-once-per-id-set primer (ownership.js's own
  // createCharacterOwnershipPrimer) — same lifecycle Orrery's own app.js
  // uses (the two used to each carry an independent, buggy copy of this;
  // see that shared helper's own comment for the infinite-loop bug this
  // replaced).
  const characterOwnershipPrimer = createCharacterOwnershipPrimer(dataManager);
  function primeCharacterOwnershipCatalog() {
    const ids = new Set();
    (map?.layers || []).forEach((layer) => {
      if (layer.type !== "marker") return;
      (layer.elements || []).forEach((marker) => {
        if (marker.kind === "marker" && marker.refKind === "character" && marker.refId) {
          ids.add(marker.refId);
        }
      });
    });
    characterOwnershipPrimer.prime(ids, () => renderLayers());
  }

  // Doors persist immediately (fresh fetch-patch-save via
  // persistElementUpdate, same as a marker move below) — this widget has no
  // Save button/local-dirty-state concept at all, unlike Orrery's own
  // authoring surface.
  async function toggleDoor(layer, elementId) {
    try {
      const freshMap = await persistElementUpdate({
        dataManager,
        mapId,
        shareToken,
        layerId: layer.id,
        elementId,
        patch: (freshElement) => {
          freshElement.doorState = freshElement.doorState === "open" ? "closed" : "open";
        },
      });
      if (!freshMap) return;
      map = freshMap;
      watcher?.noteLocalWrite();
      renderLayers();
    } catch (error) {
      status?.show(error.message || "Unable to open the door.", { type: "error" });
    }
  }

  // A small popover for re-icon/re-coloring a marker the viewer controls —
  // opened by a plain click (not a drag) on that marker, same
  // isMarkerDraggable ownership gate buildRestrictedMapOptions already makes
  // for dragging it (see onMarkerClicked below). Appended to viewerHost, a
  // sibling of the overlay renderLayers() rebuilds on every poll/live-stream
  // update — not a child of it — so an incoming update while this is open
  // doesn't tear it out from under the viewer.
  let markerEditorPopover = null;
  function closeMarkerEditor() {
    markerEditorPopover?.remove();
    markerEditorPopover = null;
    document.removeEventListener("pointerdown", onOutsidePointerDown, true);
  }
  function onOutsidePointerDown(event) {
    if (markerEditorPopover && !markerEditorPopover.contains(event.target)) {
      closeMarkerEditor();
    }
  }
  // Same fetch-fresh/patch/save immediacy as a marker drag/door toggle —
  // this widget has no Save button/local-dirty-state concept at all. Field-
  // agnostic and element-kind-agnostic on purpose: used for a marker's own
  // outlineColor/overlayIcons (the click-to-edit popover) AND a player-owned
  // shape's own origin (drag-to-move) — both are just "patch one field on
  // one element," nothing marker-specific about the mechanism itself.
  async function persistElementField(layer, elementId, field, value) {
    return persistElementFields(layer, elementId, { [field]: value });
  }
  // Same fetch-fresh/patch/save shape as persistElementField, generalized to
  // a multi-key patch object — used for the drawing color swatch, which
  // writes fillColor AND strokeColor together (one shared color, see
  // drawColor's own declaration comment) as a single round trip rather than
  // two sequential fetch-fresh/save calls racing each other.
  async function persistElementFields(layer, elementId, patch) {
    try {
      const freshMap = await persistElementUpdate({
        dataManager,
        mapId,
        shareToken,
        layerId: layer.id,
        elementId,
        patch,
      });
      if (!freshMap) return;
      map = freshMap;
      watcher?.noteLocalWrite();
      renderLayers();
    } catch (error) {
      status?.show(error.message || "Unable to save that change.", { type: "error" });
    }
  }
  // Re-reads the layer/marker from the CURRENT `map` (post-persistElementField,
  // which already replaced it) and rebuilds the popover in place — needed
  // for overlayIcons specifically, since each add/remove has to build its
  // next array off the latest server-confirmed list, not whatever was
  // captured in this popover's own closure when it first opened (two
  // additions in a row would otherwise each compute from the SAME stale
  // starting array and silently drop one of them).
  function reopenMarkerEditor(layerId, elementId, dotEl) {
    const freshLayer = map?.layers?.find((entry) => entry.id === layerId);
    const freshMarker = freshLayer?.elements?.find((entry) => entry.id === elementId);
    if (freshLayer && freshMarker) openMarkerEditor(freshLayer, freshMarker, dotEl);
  }

  // Color + icons only — no image field. A player can recolor/re-icon their
  // own token the same way they can already move it, but replacing its
  // portrait is map-design work, not a quick in-play touch-up. Kept as
  // compact as possible: no field labels beyond a title attribute, a single
  // small color swatch, and one icon-add input with existing badges shown
  // as small removable chips below it only when there are any.
  function openMarkerEditor(layer, markerElement, dotEl) {
    closeMarkerEditor();
    const popover = el("div", "orrery-floating-panel d-flex flex-column gap-1 p-1");
    popover.style.position = "fixed";
    // Wider than the bare minimum the color swatch + icon input need —
    // the icon search dropdown's own width is tied to its parent's (w-100,
    // icon-picker.js), so a narrow popover meant a narrow, hard-to-read
    // results list too.
    popover.style.width = "16rem";
    popover.style.zIndex = "1040";
    const rect = dotEl?.getBoundingClientRect?.();
    const hostRect = viewerHost.getBoundingClientRect();
    const top = rect ? rect.bottom + 4 : hostRect.top + 4;
    const left = rect ? Math.min(rect.left, hostRect.right - 264) : hostRect.left + 4;
    popover.style.top = `${top}px`;
    popover.style.left = `${Math.max(hostRect.left + 4, left)}px`;

    // One row: color swatch, icon picker directly beside it. No visible
    // labels — tooltips (native `title`, same as every other control in
    // these compact popovers) carry that instead, per the "as compact as
    // possible" brief.
    const mainRow = el("div", "d-flex align-items-center gap-1");
    const colorInput = document.createElement("input");
    colorInput.type = "color";
    colorInput.className = "form-control form-control-color p-0";
    colorInput.style.width = "1.5rem";
    colorInput.style.height = "1.5rem";
    colorInput.style.flexShrink = "0";
    colorInput.title = "Outline color";
    colorInput.setAttribute("aria-label", "Outline color");
    colorInput.value = markerElement.outlineColor || layer.settings?.outlineColor || "#0f172a";
    colorInput.addEventListener("change", () => {
      void persistElementField(layer, markerElement.id, "outlineColor", colorInput.value);
    });
    mainRow.appendChild(colorInput);

    // createIconPickerField's own wrapper is label-on-top; only its inner
    // `.input-group` (preview + search input) is reused here so it can sit
    // directly beside the color swatch in one row instead — the label
    // itself is simply never appended anywhere, `title`/aria-label below
    // carry its meaning instead.
    const iconField = createIconPickerField({
      onSelect: (value) => {
        if (!value) return;
        const nextIcons = [...(markerElement.overlayIcons || []), createMarkerOverlayIcon({ icon: value, label: value })];
        void persistElementField(layer, markerElement.id, "overlayIcons", nextIcons).then(() =>
          reopenMarkerEditor(layer.id, markerElement.id, dotEl)
        );
      },
    });
    const iconGroup = iconField.querySelector(".input-group");
    iconGroup.classList.add("flex-grow-1");
    const iconInput = iconGroup.querySelector("input");
    iconInput.title = "Add icon";
    iconInput.setAttribute("aria-label", "Add icon");
    mainRow.appendChild(iconGroup);
    popover.appendChild(mainRow);

    if ((markerElement.overlayIcons || []).length) {
      const chipRow = el("div", "d-flex flex-wrap gap-1");
      markerElement.overlayIcons.forEach((entry) => {
        const chip = el("span", "d-inline-flex align-items-center gap-1 border rounded-pill ps-1 pe-1 small");
        const iconTokens = getIconTokens(entry.icon);
        if (iconTokens.length) {
          const iconEl = document.createElement("span");
          const bootstrapToken = iconTokens.find((token) => token.startsWith("bi-"));
          iconEl.className = bootstrapToken ? `bi ${bootstrapToken}` : iconTokens.join(" ");
          chip.appendChild(iconEl);
        }
        const removeButton = document.createElement("button");
        removeButton.type = "button";
        removeButton.className = "btn-close";
        removeButton.style.width = "0.5rem";
        removeButton.style.height = "0.5rem";
        removeButton.setAttribute("aria-label", "Remove icon");
        removeButton.addEventListener("click", () => {
          const nextIcons = (markerElement.overlayIcons || []).filter((icon) => icon.id !== entry.id);
          void persistElementField(layer, markerElement.id, "overlayIcons", nextIcons).then(() =>
            reopenMarkerEditor(layer.id, markerElement.id, dotEl)
          );
        });
        chip.appendChild(removeButton);
        chipRow.appendChild(chip);
      });
      popover.appendChild(chipRow);
    }

    viewerHost.appendChild(popover);
    markerEditorPopover = popover;
    // Capture phase — a click on the marker's own dot that opened this
    // popover has already fired by the time this listener is attached
    // (openMarkerEditor runs synchronously from that same click), so it
    // never immediately closes itself.
    document.addEventListener("pointerdown", onOutsidePointerDown, true);
  }

  // A minimal sibling of openMarkerEditor above, for a marker this viewer
  // can't drag (not their own character token) but that still references a
  // real Library record — a plain click on one of those used to do nothing
  // at all. Just the marker's own label and a link out to wherever that
  // record actually lives (Vault, Forge, Repository, ...), reusing the same
  // markerEditorPopover/closeMarkerEditor/onOutsidePointerDown lifecycle
  // (only one floating panel open at a time either way).
  function openMarkerLinkPopover(markerElement, dotEl) {
    const target = resolveMarkerLinkTarget(markerElement);
    if (!target) return;
    closeMarkerEditor();
    const popover = el("div", "orrery-floating-panel d-flex flex-column gap-1 p-2");
    popover.style.position = "fixed";
    popover.style.width = "12rem";
    popover.style.zIndex = "1040";
    const rect = dotEl?.getBoundingClientRect?.();
    const hostRect = viewerHost.getBoundingClientRect();
    const top = rect ? rect.bottom + 4 : hostRect.top + 4;
    const left = rect ? Math.min(rect.left, hostRect.right - 200) : hostRect.left + 4;
    popover.style.top = `${top}px`;
    popover.style.left = `${Math.max(hostRect.left + 4, left)}px`;

    if (markerElement.label) {
      const title = el("div", "small fw-semibold text-truncate", markerElement.label);
      popover.appendChild(title);
    }
    const link = document.createElement("a");
    link.className = "btn btn-outline-secondary btn-sm d-inline-flex align-items-center gap-1";
    link.href = target.url;
    link.innerHTML = `<span class="iconify" data-icon="tabler:external-link" aria-hidden="true"></span> Open in ${target.toolLabel}`;
    popover.appendChild(link);

    viewerHost.appendChild(popover);
    markerEditorPopover = popover;
    document.addEventListener("pointerdown", onOutsidePointerDown, true);
  }

  // Fires the fetch for every character-linked marker whose Vision Range is
  // actually Bound/Formula (a plain literal Text value needs no fetch at
  // all — resolveMarkerVisionRangeCells only ever calls getCharacterPayload
  // when there's a real binding/formula string to resolve). Fire-and-forget,
  // same "populate cache, re-render once it resolves" shape as app.js's own
  // — called every renderLayers() pass, but ensureCharacterPayloadCached
  // itself is a no-op once cached/in-flight, so this is cheap after the
  // first pass.
  function primeCharacterPayloadCache() {
    (map.layers || []).forEach((layer) => {
      if (layer.type !== "marker") return;
      (layer.elements || []).forEach((marker) => {
        if (marker.kind !== "marker" || marker.refKind !== "character" || !marker.refId) return;
        if ((marker.visionRangeBinding || "").trim() || (marker.visionRangeFormula || "").trim()) {
          ensureCharacterPayloadCached(marker.refId);
        }
      });
    });
  }

  function renderLayers() {
    const overlay = baseMapManager?.getOverlayContainer();
    if (!overlay || !map) return;
    // A drag tracks the cursor via direct style mutation on its own dot
    // element (beginMarkerDrag, map-viewer.js), entirely outside this
    // function — it needs nothing from a re-render until the gesture ends
    // (onMarkerDragEnd handles that explicitly). ANY render triggered while
    // a drag is in flight would rebuild the marker layer's DOM and tear out
    // that exact dot from under the pointer-capture driving the gesture —
    // confirmed real bug, and not just from the poll (onMapChanged's own
    // isDraggingMarker guard already covered that): the ownership-catalog/
    // vision-payload caches just below each kick off their own fire-and-
    // forget fetch-then-render-again the FIRST time this runs after a
    // fresh page load, i.e. almost exactly when a first, freshly-loaded
    // test drag is most likely to be in progress. One guard here covers
    // every trigger uniformly instead of chasing each one individually.
    if (isDraggingMarker) return;
    primeCharacterPayloadCache();
    primeCharacterOwnershipCatalog();
    renderMapLayers(overlay, baseMapManager, map, {
      viewerTier,
      // Every vector layer opts into click/drag for a restricted viewer —
      // there's no dedicated "Player Drawings" layer anymore (a drawing/
      // shape just lands on whichever ordinary vector layer Draw/Shape
      // resolve via persistPlayerDrawing, same as any GM-authored one).
      // Harmless for a GM's own decorative shapes too: per-element
      // ownership (can THIS viewer actually act on THIS one drawing) is
      // checked inside onVectorPathClick/onShapeDragEnd below, not here —
      // this only controls whether a hit target exists at all. Walls/lights
      // stay non-interactive regardless (createVectorLayerElement only
      // wires their own onWallDragEnd off isSelected, which this widget
      // never sets or passes a handler for).
      isVectorLayerInteractive: () => true,
      onVectorPathClick: (layer, elementId, event) => {
        if (activeTool) return; // mid-placement — a click here is the NEXT point/shape, not a selection
        const element = layer.elements?.find((entry) => entry.id === elementId);
        if (!element || !canManageDrawing(element)) return;
        openDrawingEditor(layer, element, event);
      },
      onShapeDragEnd: (layer, elementId, nextOrigin) => {
        const element = layer.elements?.find((entry) => entry.id === elementId);
        if (!element || !canManageDrawing(element)) return;
        void persistElementField(layer, elementId, "origin", nextOrigin);
      },
      ...buildRestrictedMapOptions({
        dataManager,
        baseMapManager,
        map,
        characterOwnershipCatalog: characterOwnershipPrimer.getCatalog(),
        getCharacterPayload: getCachedCharacterPayload,
        status,
        onMarkerMoved: (layer, markerElement, snappedPosition) =>
          void persistMarkerMove(layer.id, markerElement.id, snappedPosition),
        onDoorToggled: (layer, elementId) => void toggleDoor(layer, elementId),
        onMarkerClicked: (layer, markerElement, dotEl, draggable) => {
          if (draggable) {
            openMarkerEditor(layer, markerElement, dotEl);
          } else {
            openMarkerLinkPopover(markerElement, dotEl);
          }
        },
        onDragStateChange: (dragging) => {
          isDraggingMarker = dragging;
        },
      }),
    });
  }

  // Read-modify-write against a *fresh* fetch (preferLocal: false), not the
  // in-memory `map` this widget last loaded — the GM could have changed the
  // map (new marker, layer visibility, ...) in the moments since, and a
  // stale full-object save would silently clobber that. Same reasoning as
  // combat-tracker.js's writeThroughToCharacter. Delegates to
  // map-live-sync.js's shared helper — Orrery's own authoring surface uses
  // the exact same one for the same reason.
  async function persistMarkerMove(layerId, elementId, nextPosition) {
    try {
      const freshMap = await persistMarkerMoveShared({ dataManager, mapId, shareToken, layerId, elementId, nextPosition });
      if (!freshMap) return;
      map = freshMap;
      watcher?.noteLocalWrite();
      renderLayers();
    } catch (error) {
      status?.show(error.message || "Unable to save your marker's new position.", { type: "error" });
    }
  }

  // onMapChanged has two independent triggers (the poll timer and the live
  // stream) that can overlap — watchMapForChanges single-flights its own
  // underlying fetch, but this handler itself still isn't reentrant-safe
  // once inside the `!baseMapManager` branch: a second trigger arriving
  // mid-construction could build a SECOND BaseMapManager (a second Leaflet
  // map instance) on top of the first, whose own overlay would silently
  // keep rendering its own copy of every marker underneath/alongside the
  // one from whichever instance won last — a real "second marker" a viewer
  // would see, with no code path that ever cleans up the orphaned instance.
  // watchMapForChanges' own single-flighting is enough here since this
  // handler has no further `await` inside it (unlike the old inline
  // doLoad, which awaited its own fetch) — nothing can interleave partway
  // through a single call.
  function onMapChanged(nextMap) {
    // isDraggingMarker — see buildRestrictedMapOptions' own onDragStateChange
    // comment; applying an incoming update mid-drag would rebuild the
    // marker layer's DOM out from under the pointer-capture driving that
    // gesture.
    if (destroyed || !nextMap || isDraggingMarker) return;
    map = nextMap;
    onTitleChange?.(map.name || "");
    if (!baseMapManager) {
      container.innerHTML = "";
      container.appendChild(viewerHost);
      // onViewChange re-renders layers on every Leaflet moveend/zoomend (see
      // base-maps.js's TileBaseMap.emitChange) — exactly what Orrery's own
      // app.js does with its own render function. Without this, a marker's
      // on-screen position (computed via leafletMap.latLngToLayerPoint —
      // see map-viewer.js's own comment on why that's zoom-relative) is only
      // ever correct as of whenever renderLayers() last ran; zooming without
      // it left every marker's pixel position stale until the next 30s poll.
      baseMapManager = new BaseMapManager({ container: viewerHost, onViewChange: () => renderLayers() });
    }
    // Only resets pan/zoom (setBaseMap) when the base map itself actually
    // changed — a live-triggered reload from an unrelated edit (a moved
    // marker, a renamed layer) shouldn't yank a player's view back to the
    // default every 30 seconds.
    const signature = JSON.stringify(map.baseMap);
    if (signature !== baseMapSignature) {
      baseMapSignature = signature;
      baseMapManager.setBaseMap(map.baseMap, map.view);
      // setBaseMap()'s own mount() clears `viewerHost` entirely (see
      // base-maps.js's clearContainer) — the zoom panel has to be (re)built
      // AFTER that, never before, or it's wiped out the instant this runs.
      zoomPanel = null;
    }
    if (!zoomPanel) {
      zoomPanel = buildZoomPanel();
      viewerHost.appendChild(zoomPanel);
    }
    // Also covers the case where the panel WASN'T rebuilt this pass (base
    // map unchanged) — a GM configuring Scale/Unit mid-session shouldn't
    // leave Measure stuck disabled until some unrelated base-map edit.
    refreshToolAvailability();
    renderLayers();
  }

  // watchMapForChanges owns the poll (createReliableInterval, not plain
  // window.setInterval — a Map popped out onto a physical second screen
  // sits unfocused for the whole session; plain setInterval was confirmed
  // to stall there until the window was manually refocused, see
  // reliable-interval.js's own header) plus the live-stream "wake sooner"
  // subscription.
  watcher = watchMapForChanges({
    dataManager,
    mapId,
    shareToken,
    groupId,
    pollIntervalMs: POLL_INTERVAL_MS,
    onChange: onMapChanged,
    onError: () => {
      if (!destroyed) renderError("Unable to load this map.");
    },
    // Orrery's click-to-ping tool — this widget IS the "table" a GM pings,
    // so it only ever needs to render one, never send one.
    onPing: ({ position, by }) => {
      const overlay = baseMapManager?.getOverlayContainer();
      if (!overlay || !map || !position) return;
      overlay.appendChild(createPingMarker(baseMapManager, map, position, by || ""));
    },
  });

  return {
    refresh: () => {
      watcher.refresh();
      void refreshVisibility();
    },
    // `removed` (dashboard.js's removeWidget passes true) — this instance's
    // own spotlight (if any) needs clearing, same bug/fix as handout.js's
    // own destroy(removed): without this, removing a currently-shown Map
    // orphans that spotlight entry as still "active," so adding a fresh Map
    // widget for the same record later finds it via resolveIsSpotlighted and
    // shows "Show to Table" already ON even though nothing new was ever
    // actually posted for players to be notified about.
    async destroy(removed) {
      destroyed = true;
      watcher.stop();
      resizeObserver?.disconnect();
      viewerHost.removeEventListener("pointerdown", handleToolPointerDown);
      closeMarkerEditor();
      baseMapManager?.current?.destroy?.();
      container.innerHTML = "";
      if (removed && visible && groupId) {
        try {
          await dataManager.clearSpotlight({ groupId, kind: "map", id: mapId });
        } catch (error) {
          // Best-effort cleanup — nothing meaningful to do if this fails.
        }
      }
    },
  };
}
