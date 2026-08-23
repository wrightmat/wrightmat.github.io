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
// supply (drag a character marker you own, open/close a door, and — for
// this specific map's own owner/admin, via the hasMapOwnerAccess option —
// drag/click-to-edit ANY marker, not just a character one) come from
// map-viewer.js's own buildRestrictedMapOptions — the exact same policy
// Orrery's own app.js uses for a non-owner viewer reaching Orrery directly
// (Orrery's own call site doesn't pass hasMapOwnerAccess, since a viewer in
// THAT branch is by definition not the map's owner already). This widget is
// ALWAYS that restricted view (a player's dashboard never gets full Orrery-
// style authoring — grid/layer editing, undo, ...), which is why it always
// builds those options, never the full-access ones; hasMapOwnerAccess is a
// narrower carve-out within that restricted view, not full authoring. NOT
// gated on the dashboard's separate "pinned
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
  markerPositionToLocalPixel,
  renderShapeElement,
  resolveMarkerLinkTarget,
  resolveMarkerConditionIcons,
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
import { findBindingByRole } from "../bindings.js";
import { deriveCombatBindings } from "./combat-bindings.js";
import { deriveConditionsVocabulary } from "./tag-editor.js";
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
    // (refKind, refId, linkedCombatantId) => void — dashboard.js's own
    // caller wires this to findActiveWidgetInstance("combat")?.
    // selectCombatantByRef(...), the same cross-widget "read a live sibling
    // on this dashboard" mechanism this widget's own mapId/isVisible
    // already back for combat-tracker.js's own resolveActiveMapId. Only
    // ever called for the map's own owner/admin clicking a marker that
    // actually references something (refKind+refId) — a player clicking
    // their own token has no business driving a Combat Tracker widget's
    // selection, and a decorative marker with no reference has nothing to
    // select in the first place.
    onMarkerSelected,
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
  let conditionLiveStream = null;
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
  // shouldn't leave Measure stuck disabled until some unrelated base-map
  // edit happens to rebuild the panel. Shape only needs a grid layer now
  // (Size is authored in cells, not converted through Scale/Unit — matches
  // Orrery's own updateShapeAvailability, app.js); Measure genuinely still
  // needs the full Scale per cell/Scale unit configuration, since its whole
  // job is converting cells to a real-world distance.
  function refreshToolAvailability() {
    const measureConfigured = hasMapMeasurementConfigured(map);
    const shapeAvailable = Boolean(findPrimaryGridLayer(map));
    if (measureButtonEl) {
      measureButtonEl.disabled = !measureConfigured;
      measureButtonEl.title = measureConfigured ? "Measure distance" : "Ask the GM to set a map scale to enable measuring";
    }
    if (shapeButtonEl) {
      shapeButtonEl.disabled = !shapeAvailable;
      shapeButtonEl.title = shapeAvailable ? "Draw an AoE shape" : "Ask the GM to add a grid layer to enable AoE shapes";
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
    // Wasn't needed while this only gated canManageDrawing (evaluated fresh
    // on each click, never baked into the initial render) — now that
    // isMarkerDraggable (map-viewer.js) also reads isMapOwnerOrAdmin() at
    // RENDER time (it sets a marker dot's pointer-events/cursor), the very
    // first renderLayers() pass — which fires before this async fetch
    // resolves — would otherwise draw every Monster/NPC marker as
    // non-draggable for the map's own owner until some unrelated later
    // render happened to run.
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
      const presetId = getPresetById(shapeTypeSelectEl?.value)?.category === "shapes" ? shapeTypeSelectEl.value : "circle";
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
        // Real-world distance only shown when the map actually has one
        // configured — the Shape tool itself no longer requires Scale per
        // cell/Scale unit (refreshToolAvailability's own comment), so this
        // readout has to degrade to cells-only instead of assuming a scale
        // that might not exist.
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

    // AoE shape type — same "shapes" category options as Orrery's own
    // data-shape-type select, shown only while the Shape tool is armed.
    // Player-placed annotations stay scoped to plain geometric shapes only
    // (not the "effects" category too) — unchanged from this tool's own
    // existing behavior, this widget just now reads the same shared
    // registry Orrery does instead of a separately hand-maintained list.
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
  // Also backs this widget's own condition-icon resolution (see
  // resolveMarkerConditionIconsForMarker below) — same staleness fix as
  // orrery/js/app.js's own CHARACTER_PAYLOAD_STALE_MS (see that file's
  // comment for the confirmed "cached forever, a condition added mid-session
  // never appeared" bug this closes): a plain fetch-once cache never picks
  // up a condition added via Combat Tracker while a player already has this
  // widget open.
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
        // this viewer will never gain access to, or a character deleted
        // elsewhere, is not a transient blip that's about to resolve on the
        // next render) — confirmed real bug this fixes: leaving
        // characterPayloadFetchedAt unset on failure meant the staleness
        // window never applied, so a permanently-inaccessible marker refetched
        // on literally every renderLayers() call with no backoff at all.
        characterPayloadFetchedAt.set(refId, Date.now());
        pendingCharacterFetches.delete(refId);
      });
  }

  // Condition-icon resolution — same "two independent cache instances, one
  // shared algorithm" split as resolveMarkerVisionRangeCells above:
  // map-viewer.js's own resolveMarkerConditionIcons (imported above) is the
  // ONE place the actual resolution logic lives; this widget just supplies
  // its own cache-backed getters (orrery/js/app.js keeps a parallel, but
  // independent, set of the same caches — see that file's own
  // resolveMarkerConditionIconsForMarker for why the algorithm itself isn't
  // duplicated here).
  const characterSystemIdCache = new Map();
  function getCachedCharacterSystemId(refId) {
    return characterSystemIdCache.get(refId) || "";
  }
  const systemConditionsCache = new Map();
  function getCachedSystemConditions(systemId) {
    return systemConditionsCache.get(systemId) || null;
  }
  function buildSystemConditions(fields) {
    const bindings = deriveCombatBindings(fields);
    const tagsEntry = findBindingByRole(bindings, "tags");
    const vocabulary = deriveConditionsVocabulary(fields, bindings);
    const iconMap = new Map();
    if (vocabulary && tagsEntry) {
      const vocabularyKey = tagsEntry.sourceField || "conditions";
      const field = fields.find((entry) => entry.type === "array" && entry.key === vocabularyKey);
      (field?.values || []).forEach((raw, index) => {
        const entry = vocabulary[index];
        if (entry && raw && (raw.icon || raw.color)) {
          iconMap.set(entry.id, { icon: raw.icon || "", color: raw.color || "" });
        }
      });
    }
    return { iconMap, tagsBinding: tagsEntry?.binding || "" };
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
  // -> schema), same two-hop lookup orrery/js/app.js's own
  // ensureCharacterSystemFieldsCached makes — trimmed here to just the
  // systemId (this widget has no @-autocomplete needing the full field
  // list), populating both this cache and systemConditionsCache from the
  // one fetch.
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
  // reasoning as orrery/js/app.js's own activeEncounterCache (see that
  // file's comment): a Monster/NPC combatant's live conditions only exist
  // per-instance on the Encounter record, never on the shared Monster/NPC
  // record itself. groupId is fixed for this widget's whole lifetime (an
  // init option, not derived), unlike Orrery's own per-campaign-switch
  // cache keyed by groupId — a single slot is enough here.
  // Same "cached forever, never actually re-fetched" bug as
  // characterPayloadCache above, and the same fix — see
  // orrery/js/app.js's ACTIVE_ENCOUNTER_STALE_MS comment.
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

  // Thin wrapper around map-viewer.js's own shared resolveMarkerConditionIcons
  // — see this widget's own caches just above.
  function resolveMarkerConditionIconsForMarker(markerElement) {
    return resolveMarkerConditionIcons(markerElement, {
      getCharacterPayload: getCachedCharacterPayload,
      getCharacterSystemId: getCachedCharacterSystemId,
      getSystemConditions: getCachedSystemConditions,
      getActiveEncounter: getCachedActiveEncounter,
    });
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
  // One shared roster fetch for the lifetime of this widget instance (not
  // one per popover/entry) — see resolveGiveToOptions' own header comment.
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
    // Opens for a real reference (the pre-existing "Open in <Tool>" case) OR
    // a marker carrying unclaimed Contents — see marker-contents.js's own
    // header comment for the full claim mechanism, shared as-is with
    // Orrery's own identical addition to openRestrictedMarkerLinkPopover.
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
      // the GM's own account. Not every player has this widget open, and
      // the GM should always be able to complete the delivery regardless.
      // Same claimMarkerContentEntry, just with an explicit recipient
      // override — see marker-contents.js's own resolveGiveToOptions
      // header comment. This popover (unlike Orrery's own split
      // restricted/full-access views) is shown to every viewer, so the
      // tier check genuinely gates this, not just hides it.
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
    primeConditionIconCache();
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
        resolveConditionIcons: resolveMarkerConditionIconsForMarker,
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
        // Same map-owner check canManageDrawing already uses for player-
        // drawn shapes — gives the GM full drag/click-to-edit parity on
        // Monster/NPC markers too, not just the character-ownership path
        // every other viewer is limited to.
        hasMapOwnerAccess: isMapOwnerOrAdmin,
      }),
    });
  }

  // Shapes & Effects plan, Part 5 — finds a placed, non-looping particle
  // effect by its own label, or (if it has none) by the label of the marker
  // it's attachedMarkerId-attached to ("a named trap" and "whatever's on the
  // Ancient Red Dragon" both resolve through the same lookup). Resolved
  // fresh against the currently-loaded `map` every call, never cached —
  // an attached effect's target can move/rename between macro runs.
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
  // "already played" state (map-viewer.js's own particleEffectPlayedOnce)
  // and forcing a re-render — renderMapLayers rebuilds every element fresh,
  // so the particle canvas simply gets created again and plays through.
  function triggerEffect(layer, element) {
    resetParticleEffectPlayState(element.id);
    renderLayers();
  }

  // Local, macro-driven trigger (macro-runner.js's runEffectsMacroAction) —
  // replays locally and returns the resolved element's id so the caller can
  // broadcast it to the rest of the table; throws a clear error on no match,
  // same "fail loudly to the macro's own toast" precedent runDeckMacroAction
  // already follows, rather than silently doing nothing.
  function triggerByLabel(target) {
    const found = findEffectElementByLabel(target);
    if (!found) {
      throw new Error(`No effect found matching "${target}".`);
    }
    triggerEffect(found.layer, found.element);
    return found.element.id;
  }

  // Remote broadcast delivery (dashboard.js's effectTrigger subscription) —
  // finds the exact element by id in the already-loaded map data and
  // replays it. Silently does nothing on no match (map out of date, or this
  // viewer's copy hasn't caught up yet) — same accepted tradeoff pings
  // already have, not an error worth surfacing to a viewer who did nothing.
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

  // Condition icons only actually change on an "encounter" or "character"
  // record save — Combat Tracker (combat-tracker.js) already subscribes to
  // exactly these same two live-stream kinds for the same reason (per the
  // "check for existing transport before inventing a new mechanism"
  // principle, reusing it rather than adding a second one). Without this,
  // a just-added condition only ever appeared once CHARACTER_PAYLOAD_STALE_MS/
  // ACTIVE_ENCOUNTER_STALE_MS's own staleness window happened to lapse —
  // confirmed real gap: technically correct eventually, but a GM watching
  // the table live saw a multi-second lag with no way to force it sooner.
  // This reuses the SAME pooled EventSource connectLiveStream/
  // watchMapForChanges below already opens for this group (poolKey is
  // (dataManager, groupId, shareToken) — a second connectLiveStream call
  // for the same triple is a ref-counted subscribe, not a new connection),
  // so this costs nothing extra on the wire; it just adds two more
  // listeners on it, each collapsing the relevant cache entry and
  // re-rendering immediately instead of waiting out the staleness window.
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
    // Lets a sibling widget on the SAME dashboard discover "which map is
    // this card showing" without needing it spotlighted to players at all —
    // dashboard.js's own findActiveWidgetInstance("map") reads this (via
    // its own isVisible gate just below) to resolve combat-tracker.js's own
    // "active map" for a GM who's prepping a map before revealing it. Fixed
    // for this widget instance's whole lifetime (this file's own header
    // comment — a new map means a new instance), so a plain property is
    // enough; no need for a live getter.
    mapId,
    // Shapes & Effects plan, Part 5 — see triggerByLabel/triggerElementById's
    // own comments just above.
    triggerByLabel,
    triggerElementById,
    // Map has no per-card show/hide toggle of its own (unlike Clock/
    // Calendar, which findActiveWidgetInstance's own isVisible gate was
    // originally written for) — always true once mounted, so the FIRST
    // Map card in layout order wins when a dashboard has more than one
    // (multiple: true), same accepted "which of several" tradeoff Clock/
    // Calendar's own callers already live with.
    isVisible: () => true,
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
