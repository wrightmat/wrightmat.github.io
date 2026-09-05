// A locked-down, sidebar-free viewer for a saved Map — the "player/table"
// half of Orrery's own pan/zoom/layer-rendering surface. Reuses
// BaseMapManager for the base map + pan/zoom, and map-viewer.js's
// renderMapLayers — the same top-level render loop Orrery's own app.js
// calls — so every layer type renders identically here, not just markers.
//
// This widget passes no `selection`/`activeGroup`/interactive callbacks to
// renderMapLayers, which is the opt-out mechanism — Orrery-only concerns
// (grid-cell selection, whole-layer drag, undo recording) simply never run
// when those options are absent. The interactive affordances this widget
// DOES supply (drag a character marker you own, open/close a door, and —
// via hasMapOwnerAccess — a map owner/admin dragging/editing ANY marker)
// come from map-viewer.js's own buildRestrictedMapOptions, the same policy
// Orrery's app.js uses for a non-owner viewer. This widget is ALWAYS that
// restricted view (a player's dashboard never gets full Orrery-style
// authoring); hasMapOwnerAccess is a narrower carve-out within it, not full
// authoring. NOT gated on the dashboard's separate "pinned character"
// concept — a player who owned a character but hadn't pinned it via
// Character Summary previously saw zero drag controls for their own token.
import { BaseMapManager } from "../../../../orrery/js/lib/base-maps.js";
import {
  renderMapLayers,
  createPingMarker,
  buildRestrictedMapOptions,
  resolveClickPosition,
  markerPositionToLocalPixel,
  renderShapeElement,
  resolveMarkerLinkTarget,
  resolveMarkerConditionIcons,
  resolveMarkerResourceBar,
  resetParticleEffectPlayState,
  findPrimaryGridLayer,
  hasMapMeasurementConfigured,
  pixelsToCells,
  snapCellsToWholeUnit,
  formatMeasuredDistance,
} from "../../../../orrery/js/lib/map-viewer.js";
import {
  createVectorPathElement,
  createVectorShapeElement,
  createMarkerOverlayIcon,
} from "../../../../orrery/js/lib/map-model.js";
import { getPresetById, getPresetsByCategory, getPresetDefaultValues } from "../shape-effect-library.js";
import { resolveToolHref, resolveToolContextPath } from "../app-shell.js";
import { resolveIsSpotlighted, resolveActiveSpotlightId } from "../spotlight.js";
import { createCharacterOwnershipPrimer, matchesOwner, refreshOwnershipCatalog } from "../ownership.js";
import { el } from "../dom.js";
import { getIconTokens } from "../icon-picker.js";
import { findBindingsByRole } from "../bindings.js";
import { deriveCombatBindings, guessBarResourceName } from "./combat-bindings.js";
import { buildSystemConditions } from "./tag-editor.js";
// Same icon-picker/overlay-icon shape Orrery's own marker inspector uses for
// a token's badge icons — reused as-is rather than a second, player-scoped
// copy. No image field here on purpose — a player can recolor/re-icon their
// own token, not replace its portrait.
import { createIconPickerField } from "../ui-components.js";
import { connectLiveStream } from "../live.js";
import {
  watchMapForChanges,
  persistMarkerMove as persistMarkerMoveShared,
  persistElementUpdate,
  persistPlayerDrawing,
  removeElement,
} from "../map-live-sync.js";
import { claimMarkerContentEntry, describeMarkerContentEntry, resolveGiveToOptions } from "../marker-contents.js";
import { disposeTooltips, initTooltip, setDisabledTooltip, updateTooltipContent } from "../tooltips.js";

// 10s — same reasoning as combat-tracker.js's own POLL_INTERVAL_MS, kept a
// bit more conservative since map content typically changes less often
// mid-session than combat or a clock does.
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
    // (refKind, refId, linkedCombatantId) => void — dashboard.js wires this
    // to findActiveWidgetInstance("combat")?.selectCombatantByRef(...), the
    // same cross-widget "read a live sibling" mechanism this widget's own
    // mapId/isVisible back for combat-tracker.js's resolveActiveMapId. Only
    // called for the map owner/admin clicking a marker that references
    // something — a player clicking their own token shouldn't drive Combat
    // Tracker's selection, and a decorative marker has nothing to select.
    onMarkerSelected,
  } = {}
) {
  const mapId = contentRef?.id;
  if (!container || !dataManager || !mapId) {
    return { destroy() {} };
  }

  // mapId/shareToken are fixed for this widget instance's whole lifetime (a
  // new map means a new instance, not a change to this one), so unlike the
  // map's own name (only known once load() fetches it) this can be set
  // once, right away, rather than re-derived on every poll.
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
  let conditionLiveStream = null;
  let visible = false;
  // Set true for the duration of a marker drag — onMapChanged below skips
  // an incoming poll/live-stream update while this is true, so it can't
  // rebuild the marker layer's DOM (and tear out the dot being dragged)
  // mid-gesture — otherwise a drag pops straight to the final position
  // instead of tracking the cursor.
  let isDraggingMarker = false;

  // Player toolbar tool state — instance-scoped, not local to
  // buildZoomPanel, since the panel gets rebuilt whenever the base map
  // changes; a tool already armed shouldn't disarm on an unrelated edit.
  // One at a time, unlike Orrery's own independent per-tool booleans — a
  // player toolbar with two tools armed at once (a click ambiguously
  // either pings or starts measuring) is worse for less benefit.
  let activeTool = null; // null | "ping" | "measure" | "draw" | "shape"

  // One shared "pencil color" for both Draw and Shape — a shape's
  // fillColor AND strokeColor both come from this single value, no
  // separate "outline" concept, matching Orrery's own drawColor. Instance-
  // scoped, same "survives a zoomPanel rebuild" reasoning as activeTool.
  let drawColor = "#0f172a";

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

  // Called on every buildZoomPanel AND every onMapChanged, not just when
  // the panel gets rebuilt — a GM configuring Scale/Unit mid-session
  // shouldn't leave Measure stuck disabled until some unrelated edit
  // rebuilds the panel. Shape only needs a grid layer (Size is authored in
  // cells, matching Orrery's own updateShapeAvailability); Measure needs
  // the full Scale per cell/Scale unit, since its job is converting cells
  // to a real-world distance.
  function refreshToolAvailability() {
    const measureConfigured = hasMapMeasurementConfigured(map);
    const shapeAvailable = Boolean(findPrimaryGridLayer(map));
    // setDisabledTooltip owns `disabled` itself — a real `disabled` on the
    // same element as the tooltip blocks the hover that would show it (see
    // tooltips.js's own BUG CLASS 1).
    if (measureButtonEl) {
      if (measureConfigured) {
        setDisabledTooltip(measureButtonEl, "");
        updateTooltipContent(measureButtonEl, "Measure distance");
      } else {
        setDisabledTooltip(measureButtonEl, "Ask the GM to set a map scale to enable measuring");
      }
    }
    if (shapeButtonEl) {
      if (shapeAvailable) {
        setDisabledTooltip(shapeButtonEl, "");
        updateTooltipContent(shapeButtonEl, "Draw an AoE shape");
      } else {
        setDisabledTooltip(shapeButtonEl, "Ask the GM to add a grid layer to enable AoE shapes");
      }
    }
    if (!measureConfigured && activeTool === "measure") {
      setActiveTool(activeTool);
    }
    if (!shapeAvailable && activeTool === "shape") {
      setActiveTool(activeTool);
    }
  }

  // A screen-space (position: fixed) ruler line, appended to <body> rather
  // than the map overlay — identical to Orrery's own createMeasureLine,
  // reusing its `.orrery-measure-line-overlay` CSS class.
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
  // has no Save button/local-dirty-state concept. Resolves (creating if
  // needed) an ordinary vector layer itself, so this widget never needs to
  // know or track that layer's id.
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
  // fallback — same two-step match ownership.js's matchesOwner uses) —
  // createVectorPathElement/createVectorShapeElement don't declare these
  // fields, but nothing stops a plain extra property on the returned object.
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

  // The map's OWN owner (the GM, typically) can also manage any player's
  // drawing/shape, not just their own — fetched once via the same generic
  // ownership.js helper every other record's owner-check uses. Deliberately
  // matchesOwner()/admin-tier ONLY, not allowsDelete()'s broader "or an
  // edit-permission share" rule — every campaign member already holds an
  // edit share on a spotlighted map (that's what lets players save their
  // OWN marker moves/drawings), so allowsDelete() would let any player
  // manage any other player's drawing too.
  let mapOwnerMetadata = null;
  async function loadMapOwnership() {
    const catalog = await refreshOwnershipCatalog(dataManager, "map", [mapId]);
    mapOwnerMetadata = catalog.get(mapId) || null;
    // isMarkerDraggable also reads isMapOwnerOrAdmin() at RENDER time (sets
    // a marker dot's pointer-events/cursor) — the very first renderLayers()
    // pass fires before this async fetch resolves, so without this refresh
    // every marker would draw non-draggable for the owner until some
    // unrelated later render happened to run.
    renderLayers();
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

  // One color swatch (no separate "outline" concept, same drawColor
  // unification as the toolbar) + (shapes only) opacity, plus a small red ×
  // to delete — anchored BELOW the clicked shape/path (event.target is the
  // invisible "hit" element map-viewer.js draws over the visible geometry,
  // so its bounding rect matches what's on screen), same below-anchor idiom
  // openMarkerEditor uses off its own dotEl. The older click-point anchor
  // landed the popover on top of the clicked shape's own visible center —
  // right where you'd want to see it while editing. Explicit `width` is
  // load-bearing: `.orrery-floating-panel` also sets `right: 1.5rem`, and
  // leaving width unset alongside an explicit `left` stretched the box to
  // fill the whole gap between them.
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
    colorInput.setAttribute("aria-label", "Color");
    initTooltip(colorInput, { title: "Color" });
    colorInput.value = element.strokeColor || element.fillColor || "#0f172a";
    colorInput.addEventListener("change", () => {
      // A shape's fillColor and strokeColor stay locked together (one
      // shared color); a path has no meaningful fillColor to update.
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
    deleteButton.setAttribute("aria-label", "Delete");
    initTooltip(deleteButton, { title: "Delete" });
    deleteButton.textContent = "×";
    deleteButton.addEventListener("click", () => {
      closeMarkerEditor();
      void removeDrawing(layer, element.id);
    });
    topRow.appendChild(deleteButton);
    popover.appendChild(topRow);

    // Opacity only exists on a shape's data — a drawn path has no such
    // field, same as Orrery's own inspector.
    if (element.kind === "shape") {
      const opacityInput = document.createElement("input");
      opacityInput.type = "range";
      opacityInput.className = "form-range";
      opacityInput.min = "0";
      opacityInput.max = "1";
      opacityInput.step = "0.05";
      opacityInput.setAttribute("aria-label", "Opacity");
      initTooltip(opacityInput, { title: "Opacity" });
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
  // covering every tool — mirrors Orrery's mapContainer-level pointerdown
  // listeners. A marker's own dot already calls stopPropagation() on its
  // pointerdown, so dragging/clicking a token never reaches this handler.
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
      // setupPingTool — the full SSE round-trip is too much to depend on
      // for feedback on your own click.
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
        setMeasureReadout(formatMeasuredDistance(baseMapManager, map, Math.hypot(dx, dy)));
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
          // Shape below, rather than staying armed with no way to stop.
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
      const presetId = getPresetById(shapeTypeSelectEl?.value)?.category === "shapes" ? shapeTypeSelectEl.value : "circle";
      const startClientX = event.clientX;
      const startClientY = event.clientY;
      // No target layer yet (only resolved/created server-side, at commit
      // time, by persistPlayerDrawing) — every vector layer's default
      // position is {x:0,y:0} and nothing here lets a player author one
      // with a non-zero offset, so a plain zero offset is exactly as
      // correct as fetching the real (also-zero) layer would be.
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
      // One shared color for fill AND stroke (drawColor): a shape has no
      // separate "outline" concept. Not read from any layer's settings —
      // renderShapeElement's `layer` parameter is never referenced inside
      // it, and a player-placed shape has no "selected vector layer" to
      // read defaults from (unlike Orrery's own GM tool).
      const values = { fill: drawColor, stroke: drawColor };
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
            presetId,
            origin,
            sizeCells,
            angleDeg,
            spreadDeg: 53,
            widthCells: 1,
            values,
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
        const cells = pixelsToCells(baseMapManager, map, Math.hypot(dx, dy));
        if (cells === null) {
          setShapeReadout("No grid layer to measure against.");
          sizeCells = 0;
          drawPreview();
          return;
        }
        sizeCells = snapCellsToWholeUnit(map, cells);
        angleDeg = (Math.atan2(dy, dx) * 180) / Math.PI;
        // Real-world distance only shown when the map has one configured —
        // the Shape tool no longer requires Scale per cell/Scale unit, so
        // this readout degrades to cells-only instead of assuming a scale.
        setShapeReadout(
          hasMapMeasurementConfigured(map)
            ? `${Math.round(sizeCells * map.measurement.scale)} ${map.measurement.unit} (${sizeCells.toFixed(1)} cells)`
            : `${sizeCells.toFixed(1)} cells`
        );
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
                presetId,
                origin,
                sizeCells,
                angleDeg,
                values,
                strokeWidth,
              })
            )
          );
          // Single-shot — see the Draw tool's identical comment above.
          setActiveTool("shape");
        }
      };
      window.addEventListener("pointermove", onMove);
      window.addEventListener("pointerup", onUp);
    }
  }

  // Same direct spotlightToGroup/clearSpotlight toggle Handout's own
  // visibility button uses — no modal, just an eye icon. `LINK_ONLY_KINDS`
  // already covers "map" since it's a link back into Orrery, not a
  // rendered card, but the visibility concept is identical either way.
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
    // independently toggleable.
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
    const iconEl = el("span", "iconify");
    iconEl.dataset.icon = icon;
    iconEl.setAttribute("aria-hidden", "true");
    button.appendChild(iconEl);
    return button;
  }

  // Same zoom in/out/reset controls as Orrery's own floating panel, plus
  // the Ping/Measure toggles alongside them — just the compact cluster
  // itself, not Orrery's draggable/collapsible panel chrome, which has no
  // room to mean anything in an 18rem-tall widget. Hidden while the
  // Dashboard is in edit mode so it doesn't clutter the layout view.
  function buildZoomPanel() {
    // Reuses Orrery's own `.orrery-floating-panel` class rather than a bare
    // `.btn-group` — that class gives the zoom panel its opaque
    // background/border/padding (a plain outline btn-group has only thin
    // button borders, easy to lose against map tiles) and sets z-index:
    // 1035, above Leaflet's own panes in this same stacking context.
    const panel = el("div", "orrery-floating-panel");
    panel.dataset.mapZoomPanel = "";
    // Tighter inset than Orrery's 1.5rem default — this panel floats over
    // an 18rem-tall widget, not a full-page map.
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
    initTooltip(zoomOutButton, { title: "Zoom out" });
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
    initTooltip(zoomInButton, { title: "Zoom in" });
    const zoomInIcon = el("span", "iconify");
    zoomInIcon.dataset.icon = "tabler:zoom-in";
    zoomInIcon.setAttribute("aria-hidden", "true");
    zoomInButton.appendChild(zoomInIcon);
    zoomInButton.addEventListener("click", () => baseMapManager?.zoomBy(0.25));
    buttonGroup.append(zoomOutButton, zoomResetButton, zoomInButton);

    // Ping/Measure/Draw/Shape — same four tools, same icons/tooltips as
    // Orrery's own toolbar, just this widget's compact toggle-button shape
    // instead of Orrery's larger wrapped span markup. One armed at a time —
    // see setActiveTool.
    const toolGroup = el("div", "btn-group btn-group-sm mt-1");
    toolGroup.setAttribute("role", "group");
    toolGroup.setAttribute("aria-label", "Map tools");

    pingButtonEl = createToolToggleButton({ icon: "tabler:location", label: "Ping the map" });
    initTooltip(pingButtonEl, { title: "Ping the map" });
    pingButtonEl.addEventListener("click", () => setActiveTool("ping"));

    measureButtonEl = createToolToggleButton({ icon: "tabler:ruler-2", label: "Measure distance" });
    measureButtonEl.addEventListener("click", () => {
      if (measureButtonEl.disabled) return;
      setActiveTool("measure");
    });

    drawButtonEl = createToolToggleButton({ icon: "tabler:pencil", label: "Draw" });
    initTooltip(drawButtonEl, { title: "Draw" });
    drawButtonEl.addEventListener("click", () => setActiveTool("draw"));

    shapeButtonEl = createToolToggleButton({ icon: "tabler:target", label: "Draw an AoE shape" });
    shapeButtonEl.addEventListener("click", () => {
      if (shapeButtonEl.disabled) return;
      setActiveTool("shape");
    });

    toolGroup.append(pingButtonEl, measureButtonEl, drawButtonEl, shapeButtonEl);
    panel.appendChild(toolGroup);

    // Color swatch + Shape type, one row — the swatch shown while either
    // Draw or Shape is armed, the select only for Shape, but grouped
    // together so Shape's picker always lands right of the color it'll
    // use, matching Orrery's own toolbar ordering.
    const toolOptionsRow = el("div", "d-flex align-items-center gap-1 mt-1");

    // Shared Draw/Shape color swatch — same drawColor concept as Orrery's
    // own toolbar.
    drawColorInputEl = document.createElement("input");
    drawColorInputEl.type = "color";
    drawColorInputEl.className = "form-control form-control-color form-control-sm flex-shrink-0 p-1 d-none";
    drawColorInputEl.setAttribute("aria-label", "Drawing color");
    initTooltip(drawColorInputEl, { title: "Drawing color" });
    drawColorInputEl.value = drawColor;
    drawColorInputEl.addEventListener("input", () => {
      drawColor = drawColorInputEl.value;
    });
    toolOptionsRow.appendChild(drawColorInputEl);

    // AoE shape type — same "shapes" category options as Orrery's own
    // select, shown only while the Shape tool is armed. Player-placed
    // annotations stay scoped to plain geometric shapes only (not the
    // "effects" category), reading the same shared registry Orrery does
    // instead of a separately hand-maintained list.
    shapeTypeSelectEl = document.createElement("select");
    shapeTypeSelectEl.className = "form-select form-select-sm flex-grow-1 d-none";
    shapeTypeSelectEl.setAttribute("aria-label", "AoE shape type");
    getPresetsByCategory("shapes").forEach((preset) => {
      const option = document.createElement("option");
      option.value = preset.id;
      option.textContent = preset.label;
      shapeTypeSelectEl.appendChild(option);
    });
    toolOptionsRow.appendChild(shapeTypeSelectEl);
    panel.appendChild(toolOptionsRow);

    measureReadoutEl = el("span", "small text-body-secondary d-block mt-1 d-none");
    panel.appendChild(measureReadoutEl);
    shapeReadoutEl = el("span", "small text-body-secondary d-block mt-1 d-none");
    panel.appendChild(shapeReadoutEl);

    // Re-apply whichever tool was already armed before this panel got
    // rebuilt — activeTool survives a rebuild (instance-scoped), but the
    // fresh buttons above all start unpressed until this runs.
    if (activeTool) {
      const armed = activeTool;
      activeTool = null;
      setActiveTool(armed);
    }
    refreshToolAvailability();

    return panel;
  }

  // Deliberately NOT the `.orrery-map` class — that rule is `position:
  // fixed; inset: 0`, meant for Orrery's full-page host, and would blow
  // this widget out to cover the whole viewport. BaseMapManager only needs
  // a normal positioned container with real dimensions.
  const viewerHost = el("div");
  viewerHost.style.position = "relative";
  viewerHost.style.width = "100%";
  // Always fills the widget's own mount point in both dimensions, not just
  // in forcePlayerView — every card gets a real, resizable grid cell now,
  // GM view included, so a fixed fallback height never makes sense here.
  // Tracks live on resize via plain CSS (the ResizeObserver below is still
  // needed separately, for Leaflet's own internal canvas).
  viewerHost.style.flex = "1 1 0";
  viewerHost.style.minHeight = "0";
  viewerHost.style.borderRadius = "0.5rem";
  viewerHost.style.overflow = "hidden";
  // Leaflet caches its container's pixel size at mount and doesn't notice a
  // CSS-only size change on its own — without this, resizing the grid cell
  // would leave the map canvas at its stale original size.
  const resizeObserver =
    typeof ResizeObserver !== "undefined"
      ? new ResizeObserver(() => baseMapManager?.getMap?.()?.invalidateSize?.())
      : null;
  resizeObserver?.observe(viewerHost);
  // Registered once, on the persistent viewerHost — not inside
  // buildZoomPanel, which gets discarded/rebuilt whenever the base map
  // changes.
  viewerHost.addEventListener("pointerdown", handleToolPointerDown);

  function renderError(message) {
    container.innerHTML = "";
    container.appendChild(el("p", "text-danger small mb-0", message));
  }

  // Same synchronous, cache-backed lookup Orrery's own app.js keeps (a live
  // Vision Range Binding can't be fetched inline inside the synchronous
  // render pipeline) — a separate instance here since this widget has its
  // own dataManager/lifetime, but both resolve identically, so a player's
  // fog view matches the GM's.
  // Also backs this widget's own condition-icon resolution below — same
  // staleness fix as orrery/js/app.js's CHARACTER_PAYLOAD_STALE_MS: a plain
  // fetch-once cache would never pick up a condition added via Combat
  // Tracker while a player already has this widget open.
  const CHARACTER_PAYLOAD_STALE_MS = 8000;
  const characterPayloadCache = new Map();
  const characterPayloadFetchedAt = new Map();
  const pendingCharacterFetches = new Set();
  function getCachedCharacterPayload(refId) {
    return characterPayloadCache.get(refId);
  }
  function ensureCharacterPayloadCached(refId) {
    if (!refId || pendingCharacterFetches.has(refId)) return;
    const fetchedAt = characterPayloadFetchedAt.get(refId) || 0;
    if (characterPayloadCache.has(refId) && Date.now() - fetchedAt < CHARACTER_PAYLOAD_STALE_MS) return;
    pendingCharacterFetches.add(refId);
    dataManager
      .get("character", refId, { preferLocal: false })
      .then((result) => {
        characterPayloadCache.set(refId, result?.payload || {});
        characterPayloadFetchedAt.set(refId, Date.now());
        pendingCharacterFetches.delete(refId);
        renderLayers();
      })
      .catch(() => {
        // Still stamp the timestamp on failure (a 401/403 for a reference
        // this viewer will never gain, or a character deleted elsewhere, is
        // not a transient blip about to resolve) — otherwise the staleness
        // window never applies, and a permanently-inaccessible marker
        // refetches on every renderLayers() call with no backoff.
        characterPayloadFetchedAt.set(refId, Date.now());
        pendingCharacterFetches.delete(refId);
      });
  }

  // Condition-icon resolution — same "two independent cache instances, one
  // shared algorithm" split as resolveMarkerVisionRangeCells above:
  // map-viewer.js's resolveMarkerConditionIcons is the one place the actual
  // resolution logic lives; this widget just supplies its own cache-backed
  // getters (orrery/js/app.js keeps a parallel, independent set).
  const characterSystemIdCache = new Map();
  function getCachedCharacterSystemId(refId) {
    return characterSystemIdCache.get(refId) || "";
  }
  const systemConditionsCache = new Map();
  function getCachedSystemConditions(systemId) {
    return systemConditionsCache.get(systemId) || null;
  }
  const pendingSystemConditionsFetches = new Set();
  function ensureSystemConditionsCached(systemId, onLoaded) {
    if (!systemId || systemConditionsCache.has(systemId) || pendingSystemConditionsFetches.has(systemId)) return;
    pendingSystemConditionsFetches.add(systemId);
    dataManager
      .get("systems", systemId, { preferLocal: false })
      .then((result) => {
        systemConditionsCache.set(systemId, buildSystemConditions(result?.payload?.fields || []));
      })
      .catch(() => {
        systemConditionsCache.set(systemId, { iconMap: new Map(), tagsBinding: "" });
      })
      .finally(() => {
        pendingSystemConditionsFetches.delete(systemId);
        onLoaded?.();
      });
  }
  // A character's own System, resolved via its Template (refId -> template
  // -> schema), same two-hop lookup orrery/js/app.js's
  // ensureCharacterSystemFieldsCached makes — trimmed to just the systemId
  // (no @-autocomplete needing the full field list here), populating both
  // this cache and systemConditionsCache from the one fetch.
  const pendingCharacterSystemIdFetches = new Set();
  function ensureCharacterSystemIdCached(refId, characterPayload, onLoaded) {
    if (!refId || !characterPayload) return;
    if (characterSystemIdCache.has(refId) || pendingCharacterSystemIdFetches.has(refId)) return;
    const templateId = characterPayload.template || "";
    if (!templateId) return;
    pendingCharacterSystemIdFetches.add(refId);
    (async () => {
      try {
        const templateResult = await dataManager.get("templates", templateId, { preferLocal: false });
        const systemId = templateResult?.payload?.schema || "";
        if (!systemId) return;
        characterSystemIdCache.set(refId, systemId);
        if (!systemConditionsCache.has(systemId)) {
          const systemResult = await dataManager.get("systems", systemId, { preferLocal: false });
          systemConditionsCache.set(systemId, buildSystemConditions(systemResult?.payload?.fields || []));
        }
      } catch (error) {
        // Leave uncached — a future renderLayers() pass retries.
      } finally {
        pendingCharacterSystemIdFetches.delete(refId);
        onLoaded?.();
      }
    })();
  }

  // The campaign's currently active/spotlighted Encounter — same shape and
  // reasoning as orrery/js/app.js's own activeEncounterCache: a Monster/NPC
  // combatant's live conditions only exist per-instance on the Encounter
  // record, never the shared record itself. groupId is fixed for this
  // widget's whole lifetime, unlike Orrery's per-campaign-switch cache
  // keyed by groupId — a single slot is enough here. Same staleness fix as
  // characterPayloadCache above.
  const ACTIVE_ENCOUNTER_STALE_MS = 8000;
  let activeEncounterCacheValue = null;
  let activeEncounterFetchedAt = 0;
  let pendingActiveEncounterFetch = false;
  function getCachedActiveEncounter() {
    return activeEncounterCacheValue;
  }
  function ensureActiveEncounterCached(onLoaded) {
    if (!groupId || pendingActiveEncounterFetch) return;
    if (activeEncounterCacheValue && Date.now() - activeEncounterFetchedAt < ACTIVE_ENCOUNTER_STALE_MS) return;
    pendingActiveEncounterFetch = true;
    (async () => {
      try {
        const encounterId = await resolveActiveSpotlightId(dataManager, { groupId, kind: "encounter" });
        if (!encounterId) {
          activeEncounterCacheValue = { systemId: "", combatants: [] };
          return;
        }
        const result = await dataManager.get("encounter", encounterId, { preferLocal: false });
        const payload = result?.payload || {};
        activeEncounterCacheValue = {
          systemId: payload.systemId || "",
          combatants: Array.isArray(payload.combatants) ? payload.combatants : [],
        };
      } catch (error) {
        activeEncounterCacheValue = { systemId: "", combatants: [] };
      } finally {
        activeEncounterFetchedAt = Date.now();
        pendingActiveEncounterFetch = false;
        onLoaded?.();
      }
    })();
  }

  // Thin wrapper around map-viewer.js's shared resolveMarkerConditionIcons —
  // see this widget's own caches just above.
  function resolveMarkerConditionIconsForMarker(markerElement) {
    return resolveMarkerConditionIcons(markerElement, {
      getCharacterPayload: getCachedCharacterPayload,
      getCharacterSystemId: getCachedCharacterSystemId,
      getSystemConditions: getCachedSystemConditions,
      getActiveEncounter: getCachedActiveEncounter,
    });
  }

  // A System's own `resource`-role combatBindings names — same shape as
  // systemConditionsCache above, a second independent thing this widget
  // needs to know about a System's fields (can't just reuse
  // systemConditionsCache's own fetch/cache).
  const systemResourceBarConfigCache = new Map();
  function getCachedSystemResourceBarConfig(systemId) {
    return systemResourceBarConfigCache.get(systemId) || null;
  }
  const pendingSystemResourceBarConfigFetches = new Set();
  function ensureSystemResourceBarConfigCached(systemId, onLoaded) {
    if (!systemId || systemResourceBarConfigCache.has(systemId) || pendingSystemResourceBarConfigFetches.has(systemId)) return;
    pendingSystemResourceBarConfigFetches.add(systemId);
    dataManager
      .get("systems", systemId, { preferLocal: false })
      .then((result) => {
        const fields = Array.isArray(result?.payload?.fields) ? result.payload.fields : [];
        const resourceBindings = findBindingsByRole(deriveCombatBindings(fields), "resource");
        systemResourceBarConfigCache.set(systemId, { resourceNames: resourceBindings.map((entry) => entry.name).filter(Boolean) });
      })
      .catch(() => {
        systemResourceBarConfigCache.set(systemId, { resourceNames: [] });
      })
      .finally(() => {
        pendingSystemResourceBarConfigFetches.delete(systemId);
        onLoaded?.();
      });
  }

  // Reads Orrery's own per-System "which resource is the Marker Resource
  // Bar" preference straight out of its `orrery-settings` localStorage
  // bucket — a genuinely Orrery-local display preference (which of a
  // System's several resource/value combatBindings gets its own bar),
  // not a "which field" question fieldRoles resolves. Read-only here;
  // falls back to the same guessBarResourceName heuristic Orrery uses
  // when nothing's explicitly set yet.
  function resolveEffectiveBarResourceName(systemId) {
    if (!systemId) return "";
    const explicit = dataManager?.getLocal?.("orrery-settings", systemId)?.barResourceName || "";
    if (explicit) return explicit;
    const config = getCachedSystemResourceBarConfig(systemId);
    return config ? guessBarResourceName(config.resourceNames.map((name) => ({ name }))) : "";
  }

  // Thin wrapper around map-viewer.js's own shared resolveMarkerResourceBar — same
  // "this widget only supplies its own cache-backed getters, the actual
  // resolution algorithm lives in the one shared place" shape
  // resolveMarkerConditionIconsForMarker just above already uses.
  function resolveMarkerResourceBarForMarker(markerElement) {
    const activeEncounter = getCachedActiveEncounter();
    if (!activeEncounter?.systemId) return null;
    return resolveMarkerResourceBar(markerElement, activeEncounter, resolveEffectiveBarResourceName(activeEncounter.systemId));
  }

  // Fires the fetches for every condition-icon-eligible marker on this map —
  // a Character-linked one needs its own System resolved (Template hop);
  // a Monster/NPC-linked one just needs the active Encounter (shared across
  // all such markers, fetched once). Mirrors primeCharacterPayloadCache's
  // own "cheap no-op once cached" shape.
  function primeConditionIconCache() {
    let hasMonsterOrNpcMarker = false;
    (map.layers || []).forEach((layer) => {
      if (layer.type !== "marker") return;
      (layer.elements || []).forEach((marker) => {
        if (marker.kind !== "marker" || !marker.refId) return;
        if (marker.refKind === "character") {
          // Condition icons need this marker's own character payload
          // regardless of whether it also has a Vision Range binding —
          // primeCharacterPayloadCache above only fetches it for the
          // latter, so ensure it here too (idempotent/cached either way).
          ensureCharacterPayloadCached(marker.refId);
          ensureCharacterSystemIdCached(marker.refId, getCachedCharacterPayload(marker.refId), () => renderLayers());
        } else if (marker.refKind === "monster" || marker.refKind === "npc") {
          hasMonsterOrNpcMarker = true;
        }
      });
    });
    if (hasMonsterOrNpcMarker) {
      ensureActiveEncounterCached(() => renderLayers());
      const activeEncounter = getCachedActiveEncounter();
      if (activeEncounter?.systemId) {
        ensureSystemConditionsCached(activeEncounter.systemId, () => renderLayers());
      }
    }
  }

  // The Marker Resource Bar (resolveMarkerResourceBarForMarker) shows for ANY combatant
  // with a linked marker — character, monster, or NPC alike — unlike
  // condition icons above, which only need the active Encounter fetch for
  // Monster/NPC markers (a Character's own conditions read straight off its
  // own payload instead). So this primes the active Encounter (and, once
  // its systemId is known, that System's own resource-name config)
  // whenever the map has ANY referenced marker at all, not gated on
  // Monster/NPC presence the way primeConditionIconCache's own
  // hasMonsterOrNpcMarker gate is.
  function primeResourceBarCache() {
    const hasCombatantMarker = (map.layers || []).some(
      (layer) =>
        layer.type === "marker" &&
        (layer.elements || []).some(
          (marker) =>
            marker.kind === "marker" &&
            (marker.refKind === "character" || marker.refKind === "monster" || marker.refKind === "npc") &&
            marker.refId
        )
    );
    if (!hasCombatantMarker) return;
    ensureActiveEncounterCached(() => renderLayers());
    const activeEncounter = getCachedActiveEncounter();
    if (activeEncounter?.systemId) {
      ensureSystemResourceBarConfigCached(activeEncounter.systemId, () => renderLayers());
    }
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
  // Save button/local-dirty-state concept, unlike Orrery's authoring surface.
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
  // opened by a plain click (not a drag), same isMarkerDraggable ownership
  // gate buildRestrictedMapOptions makes for dragging it. Appended to
  // viewerHost, a sibling of the overlay renderLayers() rebuilds on every
  // poll/live-stream update — not a child of it — so an incoming update
  // while this is open doesn't tear it out from under the viewer.
  let markerEditorPopover = null;
  function closeMarkerEditor() {
    // Disposed before removal — this popover's inputs carry real tooltips,
    // any of which could still be open the moment this runs. See
    // tooltips.js's own BUG CLASS 2.
    if (markerEditorPopover) disposeTooltips(markerEditorPopover);
    markerEditorPopover?.remove();
    markerEditorPopover = null;
    document.removeEventListener("pointerdown", onOutsidePointerDown, true);
  }
  function onOutsidePointerDown(event) {
    if (markerEditorPopover && !markerEditorPopover.contains(event.target)) {
      closeMarkerEditor();
    }
  }
  // Same fetch-fresh/patch/save immediacy as a marker drag/door toggle.
  // Field-agnostic and element-kind-agnostic on purpose: used for a
  // marker's outlineColor/overlayIcons AND a player-owned shape's own
  // origin (drag-to-move) — both are just "patch one field on one element."
  async function persistElementField(layer, elementId, field, value) {
    return persistElementFields(layer, elementId, { [field]: value });
  }
  // Same shape as persistElementField, generalized to a multi-key patch —
  // used for the drawing color swatch, which writes fillColor AND
  // strokeColor together as a single round trip rather than two racing
  // fetch-fresh/save calls.
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
  // Re-reads the layer/marker from the CURRENT `map` (post-
  // persistElementField, which already replaced it) and rebuilds the
  // popover in place — needed for overlayIcons specifically, since each
  // add/remove has to build its next array off the latest server-confirmed
  // list, not the popover's own stale closure (two additions in a row
  // would otherwise each compute from the same stale array and drop one).
  function reopenMarkerEditor(layerId, elementId, dotEl) {
    const freshLayer = map?.layers?.find((entry) => entry.id === layerId);
    const freshMarker = freshLayer?.elements?.find((entry) => entry.id === elementId);
    if (freshLayer && freshMarker) openMarkerEditor(freshLayer, freshMarker, dotEl);
  }

  // Color + icons only — no image field. A player can recolor/re-icon their
  // own token the same way they can already move it, but replacing its
  // portrait is map-design work, not a quick in-play touch-up. Kept
  // compact: no field labels beyond a title attribute, a small color
  // swatch, and one icon-add input with existing badges as removable chips.
  function openMarkerEditor(layer, markerElement, dotEl) {
    closeMarkerEditor();
    const popover = el("div", "orrery-floating-panel d-flex flex-column gap-1 p-1");
    popover.style.position = "fixed";
    // Wider than the bare minimum the color swatch + icon input need — the
    // icon search dropdown's width is tied to its parent's (w-100), so a
    // narrow popover meant a narrow, hard-to-read results list too.
    popover.style.width = "16rem";
    popover.style.zIndex = "1040";
    const rect = dotEl?.getBoundingClientRect?.();
    const hostRect = viewerHost.getBoundingClientRect();
    const top = rect ? rect.bottom + 4 : hostRect.top + 4;
    const left = rect ? Math.min(rect.left, hostRect.right - 264) : hostRect.left + 4;
    popover.style.top = `${top}px`;
    popover.style.left = `${Math.max(hostRect.left + 4, left)}px`;

    // One row: color swatch, icon picker directly beside it. No visible
    // labels — tooltips carry that instead.
    const mainRow = el("div", "d-flex align-items-center gap-1");
    const colorInput = document.createElement("input");
    colorInput.type = "color";
    colorInput.className = "form-control form-control-color p-0";
    colorInput.style.width = "1.5rem";
    colorInput.style.height = "1.5rem";
    colorInput.style.flexShrink = "0";
    colorInput.setAttribute("aria-label", "Outline color");
    initTooltip(colorInput, { title: "Outline color" });
    colorInput.value = markerElement.outlineColor || layer.settings?.outlineColor || "#0f172a";
    colorInput.addEventListener("change", () => {
      void persistElementField(layer, markerElement.id, "outlineColor", colorInput.value);
    });
    mainRow.appendChild(colorInput);

    // createIconPickerField's own wrapper is label-on-top; only its inner
    // `.input-group` (preview + search input) is reused here so it sits
    // directly beside the color swatch — the label is never appended,
    // `title`/aria-label below carry its meaning instead.
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
    iconInput.setAttribute("aria-label", "Add icon");
    initTooltip(iconInput, { title: "Add icon" });
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
        initTooltip(removeButton, { title: "Remove icon" });
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
    // Capture phase — a click on the marker's dot that opened this popover
    // has already fired by the time this listener is attached (this runs
    // synchronously from that same click), so it never closes itself.
    document.addEventListener("pointerdown", onOutsidePointerDown, true);
  }

  // A minimal sibling of openMarkerEditor above, for a marker this viewer
  // can't drag but that still references a real Library record — a plain
  // click on one of those used to do nothing. Just the marker's label and a
  // link out to wherever that record lives, reusing the same
  // markerEditorPopover/closeMarkerEditor/onOutsidePointerDown lifecycle.
  // One shared roster fetch for the lifetime of this widget instance.
  let giveToRosterPromise = null;
  function loadGiveToRoster() {
    if (!giveToRosterPromise) {
      giveToRosterPromise = groupId ? resolveGiveToOptions(dataManager, groupId, shareToken).catch(() => []) : Promise.resolve([]);
    }
    return giveToRosterPromise;
  }

  function openMarkerLinkPopover(layer, markerElement, dotEl) {
    const target = resolveMarkerLinkTarget(markerElement);
    const contents = markerElement.contents || [];
    // Opens for a real reference ("Open in <Tool>") OR a marker carrying
    // unclaimed Contents — see marker-contents.js's own claim mechanism,
    // shared as-is with Orrery's identical openRestrictedMarkerLinkPopover.
    if (!target && !contents.length) return;
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
    if (target) {
      const link = document.createElement("a");
      link.className = "btn btn-outline-secondary btn-sm d-inline-flex align-items-center gap-1";
      link.href = target.url;
      link.innerHTML = `<span class="iconify" data-icon="tabler:external-link" aria-hidden="true"></span> Open in ${target.toolLabel}`;
      popover.appendChild(link);
    }

    contents.forEach((entry) => {
      const row = el("div", "d-flex align-items-center justify-content-between gap-2");
      const label = el("span", "small text-truncate", describeMarkerContentEntry(entry));
      const claimButton = document.createElement("button");
      claimButton.type = "button";
      claimButton.className = "btn btn-outline-primary btn-sm flex-shrink-0";
      claimButton.textContent = "Claim";
      claimButton.addEventListener("click", async () => {
        claimButton.disabled = true;
        try {
          const result = await claimMarkerContentEntry({
            dataManager,
            groupId,
            shareToken,
            mapId,
            layerId: layer.id,
            elementId: markerElement.id,
            contentId: entry.id,
          });
          closeMarkerEditor();
          if (!result) {
            status?.show("That's already been claimed.", { type: "info", timeout: 2500 });
            return;
          }
          map = result.map;
          watcher?.noteLocalWrite();
          renderLayers();
          status?.show(`Claimed ${result.label} for ${result.destinationLabel}.`, { type: "success", timeout: 2500 });
        } catch (error) {
          claimButton.disabled = false;
          status?.show(error?.message || "Unable to claim that item.", { type: "error", timeout: 4000 });
        }
      });
      row.append(label, claimButton);
      popover.appendChild(row);

      // GM-only "Give to" — delivers this entry to a specific player's
      // Character (or the Party) instead of "Claim" always taking it for
      // the GM's own account. Same claimMarkerContentEntry, just with an
      // explicit recipient override. This popover (unlike Orrery's split
      // restricted/full-access views) is shown to every viewer, so the tier
      // check genuinely gates this, not just hides it.
      if (dataManager?.meetsTier?.("gm")) {
        const giveToSelect = document.createElement("select");
        giveToSelect.className = "form-select form-select-sm";
        giveToSelect.setAttribute("aria-label", `Give ${describeMarkerContentEntry(entry) || "item"} to`);
        const placeholderOption = document.createElement("option");
        placeholderOption.value = "";
        placeholderOption.textContent = "Give to…";
        giveToSelect.appendChild(placeholderOption);
        const partyOption = document.createElement("option");
        partyOption.value = "party";
        partyOption.textContent = "The Party";
        giveToSelect.appendChild(partyOption);
        loadGiveToRoster().then((roster) => {
          roster.forEach((option) => {
            const opt = document.createElement("option");
            opt.value = option.characterId;
            opt.textContent = option.label;
            giveToSelect.appendChild(opt);
          });
        });
        giveToSelect.addEventListener("change", async () => {
          const value = giveToSelect.value;
          if (!value) return;
          giveToSelect.disabled = true;
          try {
            const roster = await loadGiveToRoster();
            const recipient =
              value === "party"
                ? { type: "party" }
                : { type: "character", characterId: value, label: roster.find((option) => option.characterId === value)?.label || value };
            const result = await claimMarkerContentEntry({
              dataManager,
              groupId,
              shareToken,
              mapId,
              layerId: layer.id,
              elementId: markerElement.id,
              contentId: entry.id,
              recipient,
            });
            closeMarkerEditor();
            if (!result) {
              status?.show("That's already been claimed.", { type: "info", timeout: 2500 });
              return;
            }
            map = result.map;
            watcher?.noteLocalWrite();
            renderLayers();
            status?.show(`Gave ${result.label} to ${result.destinationLabel}.`, { type: "success", timeout: 2500 });
          } catch (error) {
            status?.show(error?.message || "Unable to give that item.", { type: "error", timeout: 4000 });
            giveToSelect.disabled = false;
            giveToSelect.value = "";
          }
        });
        popover.appendChild(giveToSelect);
      }
    });

    viewerHost.appendChild(popover);
    markerEditorPopover = popover;
    document.addEventListener("pointerdown", onOutsidePointerDown, true);
  }

  // Fires the fetch for every character-linked marker whose Vision Range is
  // actually Bound/Formula (a plain literal Text value needs no fetch —
  // resolveMarkerVisionRangeCells only calls getCharacterPayload when
  // there's a real binding/formula string). Fire-and-forget, called every
  // renderLayers() pass, but ensureCharacterPayloadCached is a no-op once
  // cached/in-flight, so this is cheap after the first pass.
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
    // element, entirely outside this function — it needs nothing from a
    // re-render until the gesture ends. ANY render triggered mid-drag would
    // rebuild the marker layer's DOM and tear out that exact dot from under
    // the pointer capture — not just from the poll (onMapChanged's own
    // guard covers that): the ownership/vision-payload caches below each
    // kick off their own fetch-then-render-again the first time this runs,
    // right when a first, freshly-loaded test drag is most likely
    // in-flight. One guard here covers every trigger uniformly.
    if (isDraggingMarker) return;
    primeCharacterPayloadCache();
    primeConditionIconCache();
    primeResourceBarCache();
    primeCharacterOwnershipCatalog();
    renderMapLayers(overlay, baseMapManager, map, {
      viewerTier,
      // Every vector layer opts into click/drag for a restricted viewer —
      // there's no dedicated "Player Drawings" layer (a drawing/shape lands
      // on whichever ordinary vector layer Draw/Shape resolve via
      // persistPlayerDrawing, same as any GM-authored one). Harmless for a
      // GM's own decorative shapes too: per-element ownership is checked
      // inside onVectorPathClick/onShapeDragEnd below, not here — this only
      // controls whether a hit target exists. Walls/lights stay
      // non-interactive regardless (their onWallDragEnd is wired off
      // isSelected, which this widget never sets).
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
        resolveConditionIcons: resolveMarkerConditionIconsForMarker,
        resolveResourceBar: resolveMarkerResourceBarForMarker,
        status,
        onMarkerMoved: (layer, markerElement, snappedPosition) =>
          void persistMarkerMove(layer.id, markerElement.id, snappedPosition),
        onDoorToggled: (layer, elementId) => void toggleDoor(layer, elementId),
        onMarkerClicked: (layer, markerElement, dotEl, draggable) => {
          if (isMapOwnerOrAdmin() && markerElement.refKind && markerElement.refId) {
            onMarkerSelected?.(markerElement.refKind, markerElement.refId, markerElement.linkedCombatantId);
          }
          if (draggable) {
            openMarkerEditor(layer, markerElement, dotEl);
          } else {
            openMarkerLinkPopover(layer, markerElement, dotEl);
          }
        },
        onDragStateChange: (dragging) => {
          isDraggingMarker = dragging;
        },
        // Same map-owner check canManageDrawing uses for player-drawn
        // shapes — gives the GM full drag/click-to-edit parity on
        // Monster/NPC markers too, not just character-ownership.
        hasMapOwnerAccess: isMapOwnerOrAdmin,
      }),
    });
  }

  // Finds a placed, non-looping particle effect by its own label, or (if
  // it has none) by the label of the marker it's attachedMarkerId-attached
  // to ("a named trap" and "whatever's on the Ancient Red Dragon" both
  // resolve through the same lookup). Resolved fresh against the
  // currently-loaded `map` every call, never cached — an attached effect's
  // target can move/rename between macro runs.
  function findEffectElementByLabel(target) {
    if (!map || !target) return null;
    const norm = String(target).trim().toLowerCase();
    if (!norm) return null;
    const markerLabels = new Map();
    (map.layers || []).forEach((layer) => {
      (layer.elements || []).forEach((entry) => {
        if (entry.kind === "marker") markerLabels.set(entry.id, entry.label || "");
      });
    });
    for (const layer of map.layers || []) {
      for (const element of layer.elements || []) {
        if (element.kind !== "shape") continue;
        if (getPresetById(element.presetId)?.kind !== "particles") continue;
        const ownLabel = (element.label || "").trim().toLowerCase();
        if (ownLabel) {
          if (ownLabel === norm) return { layer, element };
          continue;
        }
        if (!element.attachedMarkerId) continue;
        const markerLabel = (markerLabels.get(element.attachedMarkerId) || "").trim().toLowerCase();
        if (markerLabel && markerLabel === norm) return { layer, element };
      }
    }
    return null;
  }

  // Replays a placed effect's run() cycle locally by resetting its
  // "already played" state and forcing a re-render — renderMapLayers
  // rebuilds every element fresh, so the particle canvas gets created
  // again and plays through.
  function triggerEffect(layer, element) {
    resetParticleEffectPlayState(element.id);
    renderLayers();
  }

  // Local, macro-driven trigger — replays locally and returns the resolved
  // element's id so the caller can broadcast it to the rest of the table;
  // throws a clear error on no match, same "fail loudly to the macro's own
  // toast" precedent runDeckMacroAction follows, rather than doing nothing.
  function triggerByLabel(target) {
    const found = findEffectElementByLabel(target);
    if (!found) {
      throw new Error(`No effect found matching "${target}".`);
    }
    triggerEffect(found.layer, found.element);
    return found.element.id;
  }

  // Remote broadcast delivery — finds the exact element by id in the
  // already-loaded map data and replays it. Silently does nothing on no
  // match (map out of date, or this viewer hasn't caught up yet) — same
  // accepted tradeoff pings already have, not an error worth surfacing to
  // a viewer who did nothing.
  function triggerElementById(elementId) {
    if (!map || !elementId) return;
    for (const layer of map.layers || []) {
      const element = (layer.elements || []).find((entry) => entry.id === elementId);
      if (element) {
        triggerEffect(layer, element);
        return;
      }
    }
  }

  // Read-modify-write against a *fresh* fetch, not the in-memory `map` this
  // widget last loaded — the GM could have changed the map in the moments
  // since, and a stale full-object save would silently clobber that. Same
  // reasoning as combat-tracker.js's writeThroughToCharacter. Delegates to
  // map-live-sync.js's shared helper — Orrery's own authoring surface uses
  // the same one.
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
  // fetch, but a second trigger arriving mid-construction inside the
  // `!baseMapManager` branch could build a SECOND BaseMapManager on top of
  // the first, whose overlay would keep rendering its own copy of every
  // marker with no code path that ever cleans up the orphan. Safe here
  // since this handler has no `await` inside it — nothing can interleave
  // partway through a single call.
  function onMapChanged(nextMap) {
    // Applying an incoming update mid-drag would rebuild the marker
    // layer's DOM out from under the pointer capture driving that gesture.
    if (destroyed || !nextMap || isDraggingMarker) return;
    map = nextMap;
    onTitleChange?.(map.name || "");
    if (!baseMapManager) {
      container.innerHTML = "";
      container.appendChild(viewerHost);
      // onViewChange re-renders layers on every Leaflet moveend/zoomend,
      // exactly what Orrery's own app.js does. Without this, a marker's
      // on-screen position (zoom-relative) is only correct as of whenever
      // renderLayers() last ran — zooming without it left every marker's
      // pixel position stale until the next poll.
      baseMapManager = new BaseMapManager({ container: viewerHost, onViewChange: () => renderLayers() });
    }
    // Only resets pan/zoom when the base map itself actually changed — a
    // live-triggered reload from an unrelated edit shouldn't yank a
    // player's view back to default every poll.
    const signature = JSON.stringify(map.baseMap);
    if (signature !== baseMapSignature) {
      baseMapSignature = signature;
      baseMapManager.setBaseMap(map.baseMap, map.view);
      // setBaseMap()'s own mount() clears `viewerHost` entirely — the zoom
      // panel has to be (re)built AFTER that, never before.
      zoomPanel = null;
    }
    if (!zoomPanel) {
      zoomPanel = buildZoomPanel();
      viewerHost.appendChild(zoomPanel);
    }
    // Also covers the panel-not-rebuilt case — a GM configuring Scale/Unit
    // mid-session shouldn't leave Measure stuck disabled until some
    // unrelated base-map edit.
    refreshToolAvailability();
    renderLayers();
  }

  // Condition icons only change on an "encounter" or "character" record
  // save — Combat Tracker already subscribes to these same two live-stream
  // kinds, reused here rather than inventing a second mechanism. Without
  // this, a just-added condition only appeared once the staleness window
  // happened to lapse — technically correct eventually, but a GM watching
  // live saw a multi-second lag. Reuses the SAME pooled EventSource
  // connectLiveStream/watchMapForChanges already opens for this group (a
  // second call for the same (dataManager, groupId, shareToken) triple is
  // a ref-counted subscribe, not a new connection), so this costs nothing
  // extra on the wire — just two more listeners, each collapsing the
  // relevant cache entry and re-rendering immediately.
  if (groupId) {
    conditionLiveStream = connectLiveStream({ dataManager, groupId, kinds: ["encounter", "character"], shareToken });
    conditionLiveStream.subscribe("encounter", () => {
      activeEncounterCacheValue = null;
      activeEncounterFetchedAt = 0;
      renderLayers();
    });
    conditionLiveStream.subscribe("character", (payload) => {
      if (payload?.id) {
        characterPayloadCache.delete(payload.id);
        characterPayloadFetchedAt.delete(payload.id);
      }
      renderLayers();
    });
  }

  // watchMapForChanges owns the poll (createReliableInterval, not plain
  // window.setInterval — a Map popped out onto a physical second screen
  // sits unfocused for the whole session, and plain setInterval stalls
  // there until manually refocused) plus the live-stream "wake sooner"
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
    // so it only ever renders one, never sends one.
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
    // Lets a sibling widget on the SAME dashboard discover "which map is
    // this card showing" without needing it spotlighted to players —
    // dashboard.js's findActiveWidgetInstance("map") reads this to resolve
    // combat-tracker.js's "active map" for a GM prepping before revealing
    // it. Fixed for this widget instance's whole lifetime, so a plain
    // property is enough — no need for a live getter.
    mapId,
    triggerByLabel,
    triggerElementById,
    // Map has no per-card show/hide toggle of its own (unlike Clock/
    // Calendar) — always true once mounted, so the FIRST Map card in
    // layout order wins when a dashboard has more than one, same accepted
    // tradeoff Clock/Calendar's own callers live with.
    isVisible: () => true,
    // `removed` (dashboard.js's removeWidget passes true) — this instance's
    // own spotlight (if any) needs clearing, same fix as handout.js's own
    // destroy(removed): without it, removing a currently-shown Map orphans
    // that spotlight entry as still "active," so a fresh Map widget for
    // the same record later shows "Show to Table" already ON even though
    // nothing new was posted for players to be notified about.
    async destroy(removed) {
      destroyed = true;
      watcher.stop();
      conditionLiveStream?.close();
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
