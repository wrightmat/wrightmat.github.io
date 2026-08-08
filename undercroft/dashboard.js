import { initAppShell, resolveToolContextPath } from "./common/js/lib/app-shell.js";
import { DataManager } from "./common/js/lib/data-manager.js";
import { resolveApiBase } from "./common/js/lib/api.js";
import { initAuthControls } from "./common/js/lib/auth-ui.js";
import { initHelpSystem } from "./common/js/lib/help.js";
import { initHelpBrowser } from "./common/js/lib/help-browser.js";
import { refreshTooltips, disposeTooltips } from "./common/js/lib/tooltips.js";
import { createIconButton } from "./common/js/lib/ui-components.js";
import { createSortable } from "./common/js/lib/dnd.js";
import { initCharacterSummaryWidget } from "./common/js/lib/widgets/character-summary.js";
import { initGameLogWidget, SPOTLIGHT_KIND_LABELS, clearGameLogView } from "./common/js/lib/widgets/game-log.js";
import { initCombatTrackerWidget } from "./common/js/lib/widgets/combat-tracker.js";
import { initClockWidget } from "./common/js/lib/widgets/clocks.js";
import { initHandoutWidget, openHandoutPicker } from "./common/js/lib/widgets/handout.js";
import { initMapWidget } from "./common/js/lib/widgets/map.js";
import { initBrowserWidget } from "./common/js/lib/widgets/browser.js";
import { initCalendarWidget } from "./common/js/lib/widgets/calendar.js";
import { initSoundboardWidget } from "./common/js/lib/widgets/soundboard.js";
import { initDiceRollerWidget } from "./common/js/lib/widgets/dice-roller.js";
import { initWledWidget, resolveWledDeviceByAlias, normalizeWledDeviceList, saveWledDevices } from "./common/js/lib/widgets/wled.js";
import { initBoardWidget } from "./common/js/lib/widgets/board.js";
import { openContentPicker } from "./common/js/lib/widgets/content-picker.js";
import { resolveGroupContext } from "./common/js/lib/widgets/group-context.js";
import { watchActiveSpotlights } from "./common/js/lib/spotlight-inbox.js";
import { renderSpotlightPanel } from "./common/js/lib/widgets/spotlight-panel.js";
import { resolveActiveSpotlightId, resolveIsSpotlighted } from "./common/js/lib/spotlight.js";
import { createReliableInterval } from "./common/js/lib/reliable-interval.js";
import { loadLibraryData } from "./common/js/lib/content-fetch.js";
import { el } from "./common/js/lib/dom.js";

// Every per-browser local copy of a Dashboard setting lives under this same
// prefix + a short key — "layout" preserves the exact pre-existing
// "undercroft.dashboard.layout" key so nobody's saved local layout goes
// missing after this file's own settings model grew beyond just layout (see
// saveLocalSetting/loadLocalSetting below). Server-side, all of these settings
// share one merge-patch JSON blob (DataManager#saveUserSettings/
// getUserSettings) keyed by the matching dashboard*-prefixed name — adding a
// new setting is just a new key in that same blob, no server changes needed.
const LOCAL_SETTINGS_PREFIX = "undercroft.dashboard.";
const SORTABLE_GROUP = "dashboard-widgets";
// The grid's own lane count (CSS `grid-template-columns: repeat(N, 1fr)`,
// `common/css/shell.css`'s .dashboard-grid — driven by a CSS custom property
// set from layout.columnCount, not a fixed value; see applyGridDimensions).
// Every widget has an explicit `col`/`row` (0-indexed top-left cell) plus
// `colSpan`/`rowSpan` — real 2D placement, not list order + auto-flow (that
// broke down for SortableJS once widgets had different heights — see
// renderWidgetGrid's own comment for the drop-zone mechanism that replaced
// it). Both column and row count are per-layout, GM-configurable settings
// (the Columns/Rows inputs in Edit layout), not fixed constants — these are
// just the fallback/clamp bounds.
const DEFAULT_COLUMN_COUNT = 8;
const DEFAULT_ROW_COUNT = 8;
const GRID_COLUMN_COUNT_MIN = 2;
const GRID_COLUMN_COUNT_MAX = 12;
const GRID_ROW_COUNT_MIN = 2;
const GRID_ROW_COUNT_MAX = 40;
const COL_SPAN_MIN = 1;
const ROW_SPAN_MIN = 1;
const DEFAULT_COL_SPAN = 2;
const DEFAULT_ROW_SPAN = 4;
const ZOOM_MIN = 50;
const ZOOM_MAX = 300;
const ZOOM_STEP = 10;
const DEFAULT_ZOOM = 100;

function clampInt(value, min, max, fallback) {
  const num = Number(value);
  if (!Number.isFinite(num)) return fallback;
  return Math.min(max, Math.max(min, Math.round(num)));
}

// Reads the CURRENT layout's own grid dimensions — these are per-layout
// settings (the Columns/Rows inputs in Edit layout), not fixed constants;
// every caller that needs "how many columns/rows does THIS grid have right
// now" goes through these rather than a hardcoded number, so changing the
// setting takes effect everywhere at once. Only ever called once `layout`
// is populated (mid-boot onward) — normalizeLayout/normalizeWidgetEntry/
// packLayout run BEFORE that and take the dimensions as explicit params
// instead, since they're what's building `layout` in the first place.
function getColumnCount() {
  return layout?.columnCount || DEFAULT_COLUMN_COUNT;
}
function getRowCount() {
  return layout?.rowCount || DEFAULT_ROW_COUNT;
}

const { status } = initAppShell({
  namespace: "dashboard",
  leftPane: { size: "default", initial: "collapsed" },
  rightPane: { size: "lg", initial: "collapsed" },
});
const dataManager = new DataManager({ baseUrl: resolveApiBase(), storagePrefix: "undercroft.workbench" });
initAuthControls({ root: document, status, dataManager });
// This page lives at the suite root, one level shallower than every other
// tool page initHelpSystem's default topicsUrl assumes — same "home is the
// one exception" theme as app-shell.js's resolveToolHref/resolveAccountHref.
initHelpSystem({ root: document, topicsUrl: "common/data/help-topics.json" });

// `multiple: false` (the default when omitted) means only one instance of
// that widget type can exist at once — character/gamelog/combat are each
// tied to one thing (your pinned character, the one group log, one active
// encounter per group), so more than one copy would just show the same data
// twice. Card/Map set `multiple: true` since several different pieces of
// content can meaningfully coexist (several spotlighted NPCs, several maps).
// `icon` drives the add-widget toolbar button and its tooltip;
// `addableFromToolbar: false` (Card only) hides a type from that toolbar
// entirely when a blind "add one" click wouldn't have anything meaningful to
// show — Card only ever gets added with a real contentRef in hand, via
// acceptSpotlight below (see populateAddToolbar). Map DOES need a specific
// contentRef too, but unlike Card there's always something sensible to pick
// it from (the viewer's own saved maps) — `pickContentRef(ctx)` supplies
// that: an async function returning a `contentRef` (or null if the user
// cancelled), run from the toolbar button before addWidget is called (see
// populateAddToolbar's click handler and pickLibraryContentRef below).
// `setTitle` (passed to every widget's init via buildCtx) lets a widget
// suffix its own card header with whatever it's actually showing (a map's
// name, a character's name) — see mountWidget's own setTitle closure.
const WIDGET_CATALOG = [
  {
    id: "character",
    label: "Character sheet",
    icon: "tabler:user",
    init: (container, ctx) =>
      initCharacterSummaryWidget(container, {
        dataManager: ctx.dataManager,
        status: ctx.status,
        pinnedCharacterId: ctx.layout.pinnedCharacterId,
        groupId: ctx.groupContext?.groupId || "",
        shareToken: ctx.groupContext?.shareToken || ctx.shareParam || "",
        onPin: ctx.onPinCharacter,
        setTitle: ctx.setTitle,
        setHeaderAction: ctx.setHeaderAction,
      }),
  },
  {
    id: "gamelog",
    label: "Game log",
    icon: "tabler:message-circle",
    init: (container, ctx) =>
      initGameLogWidget(container, {
        dataManager: ctx.dataManager,
        status: ctx.status,
        groupId: ctx.groupContext?.groupId || "",
        shareToken: ctx.groupContext?.shareToken || "",
        resolveKindIcon: ctx.resolveSpotlightKindIcon,
        isSpotlightOnDashboard: ctx.isSpotlightOnDashboard,
        onToggleSpotlight: ctx.onToggleSpotlight,
        ensureTitleCached: ctx.ensureSpotlightTitleCached,
        getCachedTitle: ctx.getCachedSpotlightTitle,
        setRightAction: ctx.setRightAction,
      }),
    renderInspector(container, { api, groupContext }) {
      const info = document.createElement("p");
      info.className = "text-body-secondary small mb-0";
      info.textContent = "Shared, persistent history for the whole campaign — \"Clear log\" only hides older entries from your own view here, it never deletes anything.";
      container.appendChild(info);
      const clearButton = document.createElement("button");
      clearButton.type = "button";
      clearButton.className = "btn btn-outline-secondary btn-sm align-self-start";
      clearButton.textContent = "Clear log";
      clearButton.addEventListener("click", () => {
        clearGameLogView(groupContext?.groupId || groupContext?.shareToken || "");
        api?.refresh?.();
      });
      container.appendChild(clearButton);
    },
  },
  {
    id: "diceroller",
    label: "Dice roller",
    icon: "tabler:dice-5",
    init: (container, ctx) => initDiceRollerWidget(container, { status: ctx.status, dataManager: ctx.dataManager }),
  },
  {
    id: "wled",
    label: "Lighting (WLED)",
    icon: "tabler:bulb",
    multiple: true,
    // Account-scoped device config (wledDevices, above) with no campaign/
    // role concept at all, unlike Combat Tracker/Calendar/Soundboard below —
    // tier alone is the right (and only meaningful) gate here.
    canAdd: () => dataManager.meetsTier("gm"),
    // The known-devices LIST is account-wide (wledDevices, above — GM-tied,
    // not per-card), threaded straight from module scope rather than through
    // ctx (nothing else needs it, and every mount reads the current value at
    // mount time same as ctx.layout would). Which device THIS card shows is
    // per-instance instead, via the usual contentRef/setContentRef — see
    // wled.js's own header comment for the full split.
    init: (container, ctx) =>
      initWledWidget(container, {
        contentRef: ctx.contentRef,
        setContentRef: ctx.setContentRef,
        setTitle: ctx.setTitle,
        status: ctx.status,
        devices: wledDevices,
        onDevicesChange: persistWledDevices,
        // Phase 2 — "Follow a Clock" (wled.js's own live-binding section)
        // needs these to poll/subscribe to the spotlight transport, same as
        // every other follower in the suite.
        dataManager: ctx.dataManager,
        groupContext: ctx.groupContext,
      }),
  },
  {
    id: "board",
    label: "Board",
    icon: "tabler:layout-kanban",
    multiple: true,
    // No Library kind of its own — like Clock, the whole board (name +
    // buckets + cards) lives directly in this instance's own contentRef
    // (see board.js's own header comment). Generalizes what used to be two
    // separate widgets: a hand-curated reference/link board, and the old
    // Macro board (now retired — a card whose whole text is one
    // `` `macro:Name` `` reference renders as the same kind of big
    // icon+color button that widget used to show).
    init: (container, ctx) =>
      initBoardWidget(container, {
        contentRef: ctx.contentRef,
        setContentRef: ctx.setContentRef,
        setTitle: ctx.setTitle,
        dataManager: ctx.dataManager,
        status: ctx.status,
        groupContext: ctx.groupContext,
        instanceId: ctx.instanceId,
        // Auto-adds a live control surface (WLED/Soundboard/Combat) for
        // whatever a macro action just touched, if one isn't already on
        // this dashboard — see ensureWidgetForMacroAction's own comment.
        ensureWidget: ensureWidgetForMacroAction,
        // Live-read, not the mount-time snapshot — see buildCtx's own
        // comment. Clicking a macro-button card while rearranging the
        // layout makes no sense as "run the real macro" (lights/sound
        // firing for real while you're just dragging cards around);
        // board.js checks this at click time to redirect to Loom's Macro
        // editor instead — same behavior the old Macro board widget had.
        isEditing: ctx.isEditing,
        // Keeps this dashboard's own in-memory wledDevices (read by the WLED
        // widget's own rendering) in sync the instant a macro-button card's
        // click resolves an unconfigured alias via wled.js's own
        // promptForWledAlias — otherwise an already-mounted WLED widget
        // wouldn't reflect the new alias until a full reload. The alias
        // itself is ALWAYS persisted durably regardless (saveWledDevices,
        // called from inside the prompt) — this is purely a live-cache sync.
        onWledDevicesChange: persistWledDevices,
      }),
  },
  {
    id: "handout",
    label: "Handout",
    icon: "tabler:cards",
    multiple: true,
    // Unlike the old Card widget (addableFromToolbar: false — it only ever
    // got added via acceptSpotlight, with a contentRef already in hand), a
    // Handout is directly addable: openHandoutPicker lets the GM pick the
    // record + a print template right from the toolbar, since this widget IS
    // now the "show something to the table" entry point (see handout.js's
    // own header comment) — there's no separate per-tool button anymore.
    pickContentRef: (ctx) => openHandoutPicker({ dataManager: ctx.dataManager }),
    init: (container, ctx) => {
      // Only the group's own GM can toggle table visibility — a player who
      // accepted someone else's spotlighted Handout onto their own
      // dashboard has no spotlight to control. Also always false inside the
      // second-screen mirror (forcePlayerView) — see buildCtx's own comment.
      const canToggleVisibility = ctx.groupContext?.access === "owner" && !ctx.forcePlayerView;
      return initHandoutWidget(container, {
        dataManager: ctx.dataManager,
        status: ctx.status,
        contentRef: ctx.contentRef,
        groupId: ctx.groupContext?.groupId || "",
        shareToken: ctx.groupContext?.shareToken || ctx.shareParam || "",
        canToggleVisibility,
        setRightAction: ctx.setRightAction,
        setTitle: ctx.setTitle,
        forcePlayerView: ctx.forcePlayerView,
        plainMountContainer: ctx.plainMountContainer,
        // A Journal page rendered in here can embed its own `` `macro:...` ``
        // triggers (journal-macro.js) — this is what gives THOSE the same
        // "auto-add/reuse a live control surface" treatment the Macro board
        // widget's own runs already get, instead of always falling back to
        // the standalone, no-widget-grid path. See ensureWidgetForMacroAction's
        // own comment; only ever wired up for a real widget grid to add to,
        // same restriction as the Macro board's own use of it.
        ensureWidget: ensureWidgetForMacroAction,
      });
    },
    renderInspector(container, { instance, api }) {
      const info = document.createElement("p");
      info.className = "text-body-secondary small mb-0";
      const kind = instance.contentRef?.kind || "item";
      info.textContent = `Showing this ${kind} — use Refresh to pick up any changes since it was added.`;
      const refreshButton = document.createElement("button");
      refreshButton.type = "button";
      refreshButton.className = "btn btn-outline-secondary btn-sm align-self-start";
      refreshButton.textContent = "Refresh";
      refreshButton.addEventListener("click", () => api?.refresh?.());
      container.append(info, refreshButton);
    },
  },
  {
    id: "map",
    label: "Map",
    icon: "tabler:map-2",
    multiple: true,
    pickContentRef: (ctx) => pickLibraryContentRef(ctx.dataManager, "map", "Add a map"),
    init: (container, ctx) => {
      const canToggleVisibility = ctx.groupContext?.access === "owner" && !ctx.forcePlayerView;
      return initMapWidget(container, {
        dataManager: ctx.dataManager,
        status: ctx.status,
        contentRef: ctx.contentRef,
        groupId: ctx.groupContext?.groupId || "",
        shareToken: ctx.groupContext?.shareToken || ctx.shareParam || "",
        viewerTier: ctx.dataManager.getUserTier(),
        onTitleChange: ctx.setTitle,
        setHeaderAction: ctx.setHeaderAction,
        setRightAction: ctx.setRightAction,
        canToggleVisibility,
        editing: ctx.editing,
      });
    },
    renderInspector(container, { api }) {
      const info = document.createElement("p");
      info.className = "text-body-secondary small mb-0";
      info.textContent = "Pan and zoom with the mouse. Your own claimed character's marker (if placed on this map) is draggable — everything else is locked.";
      const refreshButton = document.createElement("button");
      refreshButton.type = "button";
      refreshButton.className = "btn btn-outline-secondary btn-sm align-self-start";
      refreshButton.textContent = "Refresh";
      refreshButton.addEventListener("click", () => api?.refresh?.());
      container.append(info, refreshButton);
    },
  },
  {
    id: "browser",
    label: "Browser",
    icon: "tabler:world",
    multiple: true,
    // No pickContentRef — unlike Handout/Map, there's no existing record to
    // pick from at all (see browser.js's own header comment); it's added
    // blank and the GM pastes a URL directly into the widget itself.
    init: (container, ctx) =>
      initBrowserWidget(container, {
        contentRef: ctx.contentRef,
        setContentRef: ctx.setContentRef,
        setTitle: ctx.setTitle,
        dataManager: ctx.dataManager,
        status: ctx.status,
        groupId: ctx.groupContext?.groupId || "",
        shareToken: ctx.groupContext?.shareToken || ctx.shareParam || "",
        canToggleVisibility: ctx.groupContext?.access === "owner" && !ctx.forcePlayerView,
        setRightAction: ctx.setRightAction,
        instanceId: ctx.instanceId,
        forcePlayerView: ctx.forcePlayerView,
      }),
  },
  {
    id: "combat",
    label: "Combat tracker",
    icon: "tabler:swords",
    // Tier OR campaign ownership — either qualifies. A gm+/creator+/admin
    // account can always add one; so can a player-tier account that GMs
    // their own active campaign (ctx.groupContext.access === "owner", the
    // same role-based signal this catalog entry's own mode below already
    // uses) — a mere player joining someone else's game can't. Matches this
    // entry's own comment just below on why tier alone can't stand in for
    // "am I GMing THIS campaign."
    canAdd: () => dataManager.meetsTier("gm") || groupContext?.access === "owner",
    // GM vs player mode is which ROLE this viewer has in the active
    // CAMPAIGN (groupContext.access — "owner" means this viewer GMs this
    // specific group; group-context.js's own comment already names Combat
    // Tracker's player mode as a consumer), not their account tier. A
    // gm/creator/admin-tier user who's just a PLAYER in someone else's game
    // was mounting in "gm" mode here — which never polls the group log for
    // a spotlighted encounter at all (see combat-tracker.js's init(): gm
    // mode only ever loads this viewer's own owned encounters) — so their
    // tracker looked permanently empty no matter what the GM spotlighted.
    init: (container, ctx) =>
      initCombatTrackerWidget(container, {
        dataManager: ctx.dataManager,
        status: ctx.status,
        // Also always "player" inside the second-screen mirror
        // (forcePlayerView), regardless of who opened it — see buildCtx's
        // own comment.
        mode: ctx.forcePlayerView ? "player" : ctx.groupContext?.access === "owner" ? "gm" : "player",
        groupId: ctx.groupContext?.groupId || "",
        shareToken: ctx.groupContext?.shareToken || ctx.shareParam || "",
        encounterId: ctx.encounterParam || "",
        setRightAction: ctx.setRightAction,
      }),
  },
  {
    id: "clock",
    label: "Clock",
    icon: "tabler:clock",
    multiple: true,
    // Authoring a clock touches no Library kind at all — it's just {name,
    // segments, filled, direction}, small enough to live entirely in this
    // instance's own contentRef (see setContentRef below) rather than
    // round-tripping through a server-backed kind. Purely local to this
    // GM's own dashboard, same as Dice Roller — except for the visibility
    // toggle (below), which is the one time clocks.js briefly touches a
    // disposable "clock" record; see that file's own comment.
    init: (container, ctx) =>
      initClockWidget(container, {
        contentRef: ctx.contentRef,
        setContentRef: ctx.setContentRef,
        setTitle: ctx.setTitle,
        dataManager: ctx.dataManager,
        status: ctx.status,
        groupId: ctx.groupContext?.groupId || "",
        shareToken: ctx.groupContext?.shareToken || ctx.shareParam || "",
        canToggleVisibility: ctx.groupContext?.access === "owner" && !ctx.forcePlayerView,
        setRightAction: ctx.setRightAction,
        instanceId: ctx.instanceId,
        forcePlayerView: ctx.forcePlayerView,
      }),
  },
  {
    id: "calendar",
    label: "Calendar",
    icon: "tabler:calendar-time",
    multiple: true,
    // Tier OR campaign ownership — same rule/reasoning as Combat Tracker's
    // own canAdd just above.
    canAdd: () => dataManager.meetsTier("gm") || groupContext?.access === "owner",
    // Picks which Setting's calendar vocabulary (months, weekday names —
    // authored in Sanctum) this instance tracks a running day count
    // against. If the picked Setting has no `.calendar` defined, the widget
    // itself shows a message and offers to pick a different one — not
    // caught here.
    pickContentRef: (ctx) => pickCalendarContentRef(ctx.dataManager),
    init: (container, ctx) =>
      initCalendarWidget(container, {
        contentRef: ctx.contentRef,
        setContentRef: ctx.setContentRef,
        setTitle: ctx.setTitle,
        dataManager: ctx.dataManager,
        status: ctx.status,
        groupId: ctx.groupContext?.groupId || "",
        shareToken: ctx.groupContext?.shareToken || ctx.shareParam || "",
        canToggleVisibility: ctx.groupContext?.access === "owner" && !ctx.forcePlayerView,
        setRightAction: ctx.setRightAction,
        instanceId: ctx.instanceId,
        forcePlayerView: ctx.forcePlayerView,
      }),
  },
  {
    id: "soundboard",
    label: "Soundboard",
    icon: "tabler:music",
    multiple: true,
    // Tier OR campaign ownership — same rule/reasoning as Combat Tracker's
    // own canAdd above.
    canAdd: () => dataManager.meetsTier("gm") || groupContext?.access === "owner",
    // No pickContentRef, and the widget itself never calls setContentRef —
    // clip definitions live in a shared, server-persisted library
    // (audio-clip-library.js) now, not per-instance, so there's nothing of
    // its own left to persist. contentRef is still threaded through and
    // read (for the accepted-follower `{followKind, followId}` shape
    // acceptSpotlight hands a new instance — see this widget's own entry
    // point), just never written back.
    init: (container, ctx) =>
      initSoundboardWidget(container, {
        contentRef: ctx.contentRef,
        setTitle: ctx.setTitle,
        dataManager: ctx.dataManager,
        status: ctx.status,
        groupId: ctx.groupContext?.groupId || "",
        shareToken: ctx.groupContext?.shareToken || ctx.shareParam || "",
        canToggleVisibility: ctx.groupContext?.access === "owner" && !ctx.forcePlayerView,
        setRightAction: ctx.setRightAction,
        instanceId: ctx.instanceId,
        forcePlayerView: ctx.forcePlayerView,
      }),
  },
];

function findCatalogEntry(widgetType) {
  return WIDGET_CATALOG.find((entry) => entry.id === widgetType);
}

// Used by Map's own `pickContentRef` above — opens the generic "pick one of
// my saved records" modal (content-picker.js) and wraps the chosen id as a
// contentRef, or returns null if the user cancelled (populateAddToolbar's
// click handler treats null as "don't add anything").
async function pickLibraryContentRef(dataManager, kind, title) {
  const id = await openContentPicker({ dataManager, kind, title });
  return id ? { id } : null;
}

// Calendar's own contentRef shape is `{settingId, dayIndex}`, not the plain
// `{id}` pickLibraryContentRef above returns — dayIndex starts at 0 (day
// 0 = campaign start) and is mutated afterward via setContentRef, same as
// every other field this picker doesn't need to know about.
async function pickCalendarContentRef(dataManager) {
  const id = await openContentPicker({ dataManager, kind: "setting", title: "Choose a Setting" });
  return id ? { settingId: id, dayIndex: 0 } : null;
}

function generateInstanceId() {
  return `w_${Math.random().toString(36).slice(2, 10)}`;
}

// Accepts a bare catalog-id string (both the pre-instance-model saved shape,
// and computeDefaultWidgets()'s own return shape) or an already-instance-
// shaped object (any prior saved shape, with or without colSpan/rowSpan/
// zoom/col/row), normalizing either into a real instance — or null for an
// unrecognized/malformed entry (dropped rather than carried forward, e.g. a
// widgetType removed from WIDGET_CATALOG since a layout was last saved).
// `col`/`row` are left absent (not defaulted here) when the source doesn't
// have them — packLayout (below) is what assigns a real position to any
// entry still missing one, since doing that correctly means knowing about
// every OTHER widget's position too, not just this one entry in isolation.
// `columnCount`/`rowCount` bound colSpan/col and rowSpan/row respectively —
// passed in explicitly (this runs before `layout` itself exists, while
// normalizeLayout is still building it, so it can't just read
// getColumnCount()/getRowCount()).
function normalizeWidgetEntry(raw, columnCount, rowCount) {
  if (typeof raw === "string") {
    return findCatalogEntry(raw)
      ? {
          instanceId: generateInstanceId(),
          widgetType: raw,
          contentRef: null,
          colSpan: DEFAULT_COL_SPAN,
          rowSpan: DEFAULT_ROW_SPAN,
          zoom: DEFAULT_ZOOM,
        }
      : null;
  }
  if (raw && typeof raw === "object" && typeof raw.widgetType === "string") {
    if (!findCatalogEntry(raw.widgetType)) return null;
    const entry = {
      instanceId: typeof raw.instanceId === "string" && raw.instanceId ? raw.instanceId : generateInstanceId(),
      widgetType: raw.widgetType,
      contentRef: raw.contentRef && typeof raw.contentRef === "object" ? raw.contentRef : null,
      colSpan: clampInt(raw.colSpan, COL_SPAN_MIN, columnCount, DEFAULT_COL_SPAN),
      rowSpan: clampInt(raw.rowSpan, ROW_SPAN_MIN, rowCount, DEFAULT_ROW_SPAN),
      zoom: clampInt(raw.zoom, ZOOM_MIN, ZOOM_MAX, DEFAULT_ZOOM),
    };
    if (Number.isInteger(raw.col) && Number.isInteger(raw.row)) {
      // Bounded by columnCount/rowCount minus their own span, not just
      // columnCount - 1 — a col/row within range on its own (e.g. 5 of 6)
      // can still push the widget's own footprint (colSpan 3 from col 5)
      // past the grid's edge.
      entry.col = clampInt(raw.col, 0, Math.max(0, columnCount - entry.colSpan), 0);
      entry.row = clampInt(raw.row, 0, Math.max(0, rowCount - entry.rowSpan), 0);
    }
    return entry;
  }
  return null;
}

// Assigns col/row to any widget that doesn't already have one (a fresh
// widgetType-string entry, or one saved before this file tracked position at
// all — every existing user's layout, the first time it loads after this
// change), via simple top-left-first shelf packing: scan cells in reading
// order, place each such widget in the first spot its own colSpan/rowSpan
// footprint fits without overlapping anything already placed (including
// OTHER widgets that already have a real position, reserved first so this
// never displaces them). Existing explicit positions are always left alone —
// this only ever fills in the gaps, never rearranges what's already placed.
// `columnCount`/`rowCount` — see normalizeWidgetEntry's own comment on why
// they're params here rather than getColumnCount()/getRowCount(). Both are
// now hard boundaries (not just a starting search size) — a widget that
// genuinely doesn't fit anywhere within them falls back to (0,0), overlapping
// whatever's there, rather than being placed off-grid; the GM can always
// grow the grid or move things to make room, same as filling a real grid
// full of furniture.
function packLayout(widgets, columnCount, rowCount) {
  const occupied = []; // occupied[row] is a Set of occupied columns in that row.
  const isFree = (col, row, colSpan, rowSpan) => {
    for (let r = row; r < row + rowSpan; r += 1) {
      for (let c = col; c < col + colSpan; c += 1) {
        if (c >= columnCount) return false;
        if (occupied[r]?.has(c)) return false;
      }
    }
    return true;
  };
  const markOccupied = (col, row, colSpan, rowSpan) => {
    for (let r = row; r < row + rowSpan; r += 1) {
      occupied[r] = occupied[r] || new Set();
      for (let c = col; c < col + colSpan; c += 1) occupied[r].add(c);
    }
  };
  widgets.forEach((instance) => {
    if (Number.isInteger(instance.col) && Number.isInteger(instance.row)) {
      markOccupied(instance.col, instance.row, instance.colSpan, instance.rowSpan);
    }
  });
  widgets.forEach((instance) => {
    if (Number.isInteger(instance.col) && Number.isInteger(instance.row)) return;
    let placedCol = -1;
    let placedRow = -1;
    for (let row = 0; row <= rowCount - instance.rowSpan && placedCol === -1; row += 1) {
      for (let col = 0; col <= columnCount - instance.colSpan; col += 1) {
        if (isFree(col, row, instance.colSpan, instance.rowSpan)) {
          placedCol = col;
          placedRow = row;
          break;
        }
      }
    }
    instance.col = placedCol === -1 ? 0 : placedCol;
    instance.row = placedRow === -1 ? 0 : placedRow;
    markOccupied(instance.col, instance.row, instance.colSpan, instance.rowSpan);
  });
  return widgets;
}

// Accepts the current flat `{widgets: [{instanceId,widgetType,contentRef,
// colSpan,rowSpan,zoom}, ...]}` shape, the pre-grid `{columns: [[...], ...]}`
// shape (every existing user's actual saved layout as of this file's own
// grid rework — flattened here column-major, preserving each column's own
// top-to-bottom reading order, with normalizeWidgetEntry defaulting the new
// size fields), or the original pre-columns `{widgets: [id, ...]}` shape
// (bare string ids — normalizeWidgetEntry handles those too) — so an
// existing user's customization survives this file's data-model changes
// instead of being dropped on first load after one.
function normalizeLayout(raw) {
  const columnCount = clampInt(raw?.columnCount, GRID_COLUMN_COUNT_MIN, GRID_COLUMN_COUNT_MAX, DEFAULT_COLUMN_COUNT);
  const rowCount = clampInt(raw?.rowCount, GRID_ROW_COUNT_MIN, GRID_ROW_COUNT_MAX, DEFAULT_ROW_COUNT);
  if (raw && Array.isArray(raw.widgets)) {
    return {
      widgets: packLayout(
        raw.widgets.map((entry) => normalizeWidgetEntry(entry, columnCount, rowCount)).filter(Boolean),
        columnCount,
        rowCount
      ),
      pinnedCharacterId: raw.pinnedCharacterId || "",
      columnCount,
      rowCount,
    };
  }
  if (raw && Array.isArray(raw.columns) && raw.columns.length) {
    const widgets = [];
    raw.columns.forEach((column) => {
      if (Array.isArray(column)) {
        widgets.push(...column.map((entry) => normalizeWidgetEntry(entry, columnCount, rowCount)).filter(Boolean));
      }
    });
    return {
      widgets: packLayout(widgets, columnCount, rowCount),
      pinnedCharacterId: raw.pinnedCharacterId || "",
      columnCount,
      rowCount,
    };
  }
  return null;
}

function loadLocalSetting(key) {
  try {
    const raw = localStorage.getItem(`${LOCAL_SETTINGS_PREFIX}${key}`);
    return raw ? JSON.parse(raw) : null;
  } catch (error) {
    return null;
  }
}

function saveLocalSetting(key, value) {
  try {
    localStorage.setItem(`${LOCAL_SETTINGS_PREFIX}${key}`, JSON.stringify(value));
  } catch (error) {
    // Local storage may be unavailable (private browsing, quota) — the
    // server sync below (when signed in) still gives this a home.
  }
}

// Shared by every persist*() below — local copy always, server copy too once
// signed in (a merge-patch, so writing one key here never clobbers another).
function persistSetting(localKey, serverKey, value) {
  saveLocalSetting(localKey, value);
  if (dataManager.isAuthenticated()) {
    dataManager.saveUserSettings({ [serverKey]: value }).catch((error) => {
      status?.show(error.message || "Unable to sync your dashboard settings.", { type: "error" });
    });
  }
}

// Only affects the very first load, before anyone has customized anything —
// an anonymous/no-context visitor now just gets an empty layout (there's no
// longer a "Jump to a tool" catch-all widget to fall back to; the tool
// switcher in the header already covers that job). Nothing defaults to a
// Card widget since there's nothing to show one of yet — the Game Log and
// the spotlight-accept toast (acceptSpotlight below) are how those show up.
async function computeDefaultWidgets() {
  if (!dataManager.isAuthenticated()) {
    return [];
  }
  if (dataManager.meetsTier("gm")) {
    return ["combat"];
  }
  const context = await resolveGroupContext(dataManager, {});
  return context ? ["character", "gamelog"] : [];
}

// One settings fetch (when signed in) backs layout, background, and header
// title alike, instead of three separate GET /auth/profile/settings round
// trips for the same blob — see loadLayout/loadBackground/loadHeaderTitle
// below, each of which takes this as a parameter rather than fetching its own.
async function loadServerSettings() {
  if (!dataManager.isAuthenticated()) return null;
  try {
    return await dataManager.getUserSettings();
  } catch (error) {
    return null;
  }
}

async function loadLayout(serverSettings) {
  const normalized = normalizeLayout(serverSettings?.dashboardLayout);
  if (normalized) return normalized;
  const normalizedLocal = normalizeLayout(loadLocalSetting("layout"));
  if (normalizedLocal) return normalizedLocal;
  const defaults = (await computeDefaultWidgets())
    .map((entry) => normalizeWidgetEntry(entry, DEFAULT_COLUMN_COUNT, DEFAULT_ROW_COUNT))
    .filter(Boolean);
  return {
    widgets: packLayout(defaults, DEFAULT_COLUMN_COUNT, DEFAULT_ROW_COUNT),
    pinnedCharacterId: "",
    columnCount: DEFAULT_COLUMN_COUNT,
    rowCount: DEFAULT_ROW_COUNT,
  };
}

function persistLayout() {
  persistSetting("layout", "dashboardLayout", layout);
}

// "" means no override — computeDefaultBackground()'s CSS default applies.
function loadBackground(serverSettings) {
  if (typeof serverSettings?.dashboardBackground === "string") return serverSettings.dashboardBackground;
  const local = loadLocalSetting("background");
  return typeof local === "string" ? local : "";
}

function persistBackground(color) {
  background = color;
  persistSetting("background", "dashboardBackground", color);
}

function applyBackground(color) {
  if (!mainEl) return;
  mainEl.style.backgroundColor = color || "";
  if (colorInput) colorInput.value = color || "#ffffff";
}

// "" means no override — falls back to the computed default (campaign name →
// signed-in user's name → "Welcome!") every time it's applied, so switching
// campaigns (via onPinCharacter) or signing in later updates it live.
function loadHeaderTitle(serverSettings) {
  if (typeof serverSettings?.dashboardHeaderTitle === "string") return serverSettings.dashboardHeaderTitle;
  const local = loadLocalSetting("headerTitle");
  return typeof local === "string" ? local : "";
}

function persistHeaderTitle(title) {
  headerTitleOverride = title;
  persistSetting("headerTitle", "dashboardHeaderTitle", title);
}

function computeDefaultHeaderTitle() {
  if (groupContext?.groupName) return groupContext.groupName;
  const username = dataManager.session?.user?.username;
  if (username) return username;
  // No campaign, not signed in — the exact same condition
  // shouldShowWelcomeScreen checks (that one also requires an empty
  // layout), so this heading and the welcome cards below it always agree.
  return "Welcome!";
}

function applyHeaderTitle() {
  const defaultTitle = computeDefaultHeaderTitle();
  if (titleDisplay) titleDisplay.textContent = headerTitleOverride || defaultTitle;
  if (titleInput) {
    titleInput.placeholder = defaultTitle;
    // Don't stomp what's mid-typing — this can be called (e.g. from
    // onPinCharacter's re-render) while the title input is focused.
    if (document.activeElement !== titleInput) {
      titleInput.value = headerTitleOverride || "";
    }
  }
}

function loadPinnedHelpTopics(serverSettings) {
  if (Array.isArray(serverSettings?.dashboardPinnedHelpTopics)) {
    return serverSettings.dashboardPinnedHelpTopics.filter((id) => typeof id === "string");
  }
  const local = loadLocalSetting("pinnedHelpTopics");
  return Array.isArray(local) ? local.filter((id) => typeof id === "string") : [];
}

function togglePinnedHelpTopic(topicId) {
  const index = pinnedHelpTopics.indexOf(topicId);
  if (index === -1) pinnedHelpTopics.push(topicId);
  else pinnedHelpTopics.splice(index, 1);
  persistSetting("pinnedHelpTopics", "dashboardPinnedHelpTopics", pinnedHelpTopics);
}

function loadWledDevices(serverSettings) {
  if (Array.isArray(serverSettings?.dashboardWledDevices)) {
    return normalizeWledDeviceList(serverSettings.dashboardWledDevices);
  }
  return normalizeWledDeviceList(loadLocalSetting("wledDevices"));
}

// Delegates to wled.js's own saveWledDevices rather than the generic
// persistSetting helper every other Dashboard setting uses — that module
// owns the exact two key strings ("undercroft.dashboard.wledDevices" local /
// "dashboardWledDevices" server) this function's own literals used to
// duplicate, and promptForWledAlias (wled.js, invoked from anywhere a macro
// runs — see macro-runner.js's own runMacro) needs to write through that
// exact same pair too. One canonical read/write path for this one setting,
// not two independently-typed copies of the same key names that could
// quietly drift apart.
function persistWledDevices(devices) {
  wledDevices = Array.isArray(devices) ? devices : [];
  void saveWledDevices(dataManager, wledDevices).catch((error) => {
    status?.show(error.message || "Unable to sync your dashboard settings.", { type: "error" });
  });
}

// Which widget type a spotlighted library kind turns into on Accept. Was
// missing "journal" — handout.js's own HANDOUT_KINDS (its picker's real,
// full list of spotlightable kinds) includes it alongside npc/location/
// monster/effect, but it had no entry here at all. Confirmed real bug:
// spotlighting a Journal page as a Handout produced a real `spotlight` log
// entry same as any other kind, but acceptSpotlight below bailed silently
// the instant `KIND_WIDGET_MAP[kind]` came back undefined — no prompt, no
// Game Log toggle, no error, nothing.
const KIND_WIDGET_MAP = {
  npc: "handout",
  location: "handout",
  monster: "handout",
  effect: "handout",
  journal: "handout",
  encounter: "combat",
  map: "map",
  clock: "clock",
  browser: "browser",
  calendar: "calendar",
  soundboard: "soundboard",
};

// Kinds with no Library record at all (server/groups.py's own
// _INLINE_SPOTLIGHT_KINDS) — accepting one of these can't hand the new
// widget a `{kind, id, templateId}` contentRef to fetch, since there's
// nothing to fetch; instead it becomes a read-only follower that polls the
// spotlight entry's own inline `data` (spotlight.js's resolveSpotlightData).
const INLINE_FOLLOW_KINDS = new Set(["clock", "browser", "calendar", "soundboard"]);

// Widget types that auto-discover whatever's currently spotlighted on their
// own poll/live-stream cycle (combat-tracker.js's resolveActiveEncounterId)
// — accepting one of these just means "make sure one instance exists,"
// never a contentRef.
const AUTO_DISCOVER_WIDGET_TYPES = new Set(["combat"]);

// Widget types with their own "show to table" visibility toggle (handout/
// map/clock/browser via canToggleVisibility, combat via its own internal
// mode-gated eye icon) — exactly the ones eligible to appear on the
// second-screen mirror (renderScreenView), since a widget type with no
// visibility concept at all (character/gamelog/diceroller) has no notion
// of "shown to table."
const TABLE_WIDGET_TYPES = new Set(["handout", "map", "clock", "combat", "browser", "calendar", "soundboard"]);

// Widget types that never get the per-widget zoom stepper at all (no zoom
// control shown, always mounted unzoomed) — CSS zoom conflicts with
// JS-measurement-based scaling for these. Handout opts individual content
// out itself (ctx.plainMountContainer) since only SOME of what it renders
// (Press-templated cards) has that same conflict — journal pages don't.
const ZOOM_EXCLUDED_WIDGET_TYPES = new Set(["map"]);

// Resource title lookup, shared by the spotlight panel's own tooltips and
// the Game Log's per-entry detail text — one cache, not two independently-
// fetched copies. Mirrors the exact fetch-once-cache-then-rerender shape
// orrery/js/app.js and common/js/lib/widgets/map.js already use for their
// own character-payload caches. Only meaningful for Library-backed kinds
// (npc/location/monster/effect/journal/map/encounter — all real,
// individually fetchable Library records); the four inline kinds (clock/
// browser/calendar/soundboard) have no record to fetch at all, see
// game-log.js's own inline-kind fallback for those.
const titleCache = new Map(); // "kind:id" -> title string
const pendingTitleFetches = new Set();
function ensureTitleCached(kind, id, onLoaded) {
  const key = `${kind}:${id}`;
  if (!kind || !id || titleCache.has(key) || pendingTitleFetches.has(key)) return;
  pendingTitleFetches.add(key);
  loadLibraryData(`${kind}/${id}`, dataManager, groupContext?.shareToken || shareParam)
    .then((payload) => {
      titleCache.set(key, payload?.title || payload?.name || "");
      pendingTitleFetches.delete(key);
      onLoaded?.();
    })
    .catch(() => pendingTitleFetches.delete(key));
}

// Given {kind,id} from a spotlight's own payload, does THIS viewer already
// have a matching widget on their own dashboard — the inverse question of
// isInstanceSpotlighted below (which starts from a widget and asks "is it
// currently the active spotlight"). Mirrors acceptSpotlight's own kind
// branching exactly (same three cases: auto-discover, inline-follow, plain
// contentRef-matched), since "am I showing this" and "would accepting this
// be a no-op" are the same underlying question from opposite directions.
function isSpotlightItemOnMyDashboard({ kind, id }) {
  const widgetType = KIND_WIDGET_MAP[kind];
  if (!widgetType) return false;
  if (AUTO_DISCOVER_WIDGET_TYPES.has(widgetType)) {
    return allWidgetTypes().includes(widgetType);
  }
  if (INLINE_FOLLOW_KINDS.has(kind)) {
    return layout.widgets.some(
      (instance) =>
        instance.widgetType === widgetType &&
        (instance.instanceId === id || (instance.contentRef?.followKind === kind && instance.contentRef?.followId === id))
    );
  }
  if (widgetType === "map") {
    // Map's own toolbar pickContentRef (pickLibraryContentRef) hands back a
    // bare {id} — NOT {kind,id,templateId} like every other non-inline,
    // non-auto-discover kind below. A GM's own directly-added map has
    // contentRef.kind === undefined; matching on contentRef.kind here would
    // wrongly report their own map as "not on my dashboard."
    return layout.widgets.some((instance) => instance.widgetType === "map" && instance.contentRef?.id === id);
  }
  return layout.widgets.some(
    (instance) => instance.widgetType === widgetType && instance.contentRef?.kind === kind && instance.contentRef?.id === id
  );
}

// The "toggle off" half — finds and removes whatever widget instance
// isSpotlightItemOnMyDashboard just confirmed exists, using the identical
// matching rules. Combat (kind "encounter") is a deliberate exception: its
// own widget (combat-tracker.js) has no per-instance visibility flag and no
// `destroy(removed)` spotlight-clear at all — GM and player share the same
// widget shape (mode decided live from groupContext.access), so removing it
// wouldn't stop the encounter being shown to the table, which would read as
// broken rather than "off." No safe generic action exists there.
function removeSpotlightItemFromDashboard({ kind, id }) {
  const widgetType = KIND_WIDGET_MAP[kind];
  if (widgetType === "combat") {
    status?.show("Remove the Combat Tracker widget itself to take this off your dashboard.", { type: "info", timeout: 3000 });
    return;
  }
  const instance = layout.widgets.find((entry) => {
    if (entry.widgetType !== widgetType) return false;
    if (INLINE_FOLLOW_KINDS.has(kind)) {
      return entry.instanceId === id || (entry.contentRef?.followKind === kind && entry.contentRef?.followId === id);
    }
    if (widgetType === "map") return entry.contentRef?.id === id;
    return entry.contentRef?.kind === kind && entry.contentRef?.id === id;
  });
  if (instance) removeWidget(instance.instanceId);
}

// The single accept path both the spotlight panel and the Game Log widget's
// own clickable icon call when a spotlighted item isn't yet on this
// dashboard — "one accept path, multiple places to trigger it."
function acceptSpotlight({ kind, id, templateId }) {
  // Idempotent — a real two-way toggle (toggleSpotlightItem below) needs
  // "accept something already accepted" to be a safe no-op, not a
  // duplicate widget instance. Confirmed real gap before this: neither this
  // function nor addWidget ever checked for an existing match.
  if (isSpotlightItemOnMyDashboard({ kind, id })) return;
  const widgetType = KIND_WIDGET_MAP[kind];
  if (!widgetType || !findCatalogEntry(widgetType)) {
    status?.show("This can't be added to your dashboard yet.", { type: "info", timeout: 2500 });
    return;
  }
  if (AUTO_DISCOVER_WIDGET_TYPES.has(widgetType)) {
    addWidget(widgetType);
  } else if (INLINE_FOLLOW_KINDS.has(kind)) {
    // No Library record to reference here — `id` is the GM's own widget
    // instance id, and the follower just polls that instance's own spotlight
    // entry for its latest `data` (see clocks.js/browser.js's own follower
    // paths, and spotlight.js's resolveSpotlightData).
    addWidget(widgetType, { followKind: kind, followId: id });
  } else {
    addWidget(widgetType, { kind, id, templateId: templateId || "" });
  }
  status?.show("Added to your dashboard.", { type: "success", timeout: 2000 });
}

// Add-if-absent, remove-if-present — the click behavior both the spotlight
// panel and the Game Log's per-entry icon share.
function toggleSpotlightItem({ kind, id, templateId }) {
  if (isSpotlightItemOnMyDashboard({ kind, id })) {
    removeSpotlightItemFromDashboard({ kind, id });
  } else {
    acceptSpotlight({ kind, id, templateId });
  }
}

// Recomputes and redraws the persistent spotlight panel. Called with a
// fresh array whenever the watcher below reports one (a new poll tick), or
// with no argument at all to just recompute isOnDashboard/re-render against
// whatever was last fetched (addWidget/removeWidget do this so a local
// toggle reflects instantly, not just on the next poll).
let lastActiveSpotlights = [];
let knownActiveSpotlightKeys = new Set();
function refreshSpotlightPanel(activeEntries) {
  if (Array.isArray(activeEntries)) lastActiveSpotlights = activeEntries;
  // A spotlight flagged data.hidden (combat-tracker.js's own hideFromTable
  // — "run this encounter without showing it to the table," while staying
  // findable for character-sheet.js's own initiative push) is deliberately
  // invisible everywhere, not just to players — no icon, no flourish, full
  // stop, per the confirmed intent behind that flag.
  const items = lastActiveSpotlights
    .filter((entry) => entry.payload?.data?.hidden !== true)
    .map((entry) => {
    const kind = String(entry.payload?.kind || "").trim();
    const id = String(entry.payload?.id || "").trim();
    const key = `${kind}:${id}`;
    const widgetType = KIND_WIDGET_MAP[kind];
    const catalogEntry = widgetType ? findCatalogEntry(widgetType) : null;
    // Only Library-backed kinds have a record to fetch a title from at all
    // — confirmed real bug: calling this unconditionally for an inline kind
    // (clock/browser/calendar/soundboard, which spotlight by this widget's
    // own instanceId, not a Library record id) fired a doomed
    // GET /content/soundboard/<instanceId> every single poll, 404-ing
    // forever since no such record has ever existed.
    if (!INLINE_FOLLOW_KINDS.has(kind)) {
      ensureTitleCached(kind, id, () => refreshSpotlightPanel());
    }
    return {
      key,
      kind,
      id,
      templateId: entry.payload?.templateId || "",
      icon: catalogEntry?.icon || "tabler:sparkles",
      title: titleCache.get(key) || SPOTLIGHT_KIND_LABELS[kind] || kind,
      isOnDashboard: isSpotlightItemOnMyDashboard({ kind, id }),
      isNew: Array.isArray(activeEntries) && !knownActiveSpotlightKeys.has(key),
    };
  });
  // Only advance the "known" baseline on a genuine poll result (an
  // activeEntries array) — a no-arg recompute (after a local add/remove)
  // must never itself mark anything "no longer new," or a flourish still
  // mid-animation could be cut off by the very click that triggered it.
  if (Array.isArray(activeEntries)) knownActiveSpotlightKeys = new Set(items.map((item) => item.key));
  renderSpotlightPanel(items, { onToggle: toggleSpotlightItem, onClear: forceClearSpotlight, editing });
}

// The "little red X" escape hatch — force-clears a spotlight log entry
// directly, bypassing the whole widget-instance/ownership question
// entirely. Only shown (spotlight-panel.js) in edit mode, for exactly the
// case toggleSpotlightItem/removeSpotlightItemFromDashboard can't already
// handle cleanly: a STALE or orphaned spotlight — e.g. from before a given
// widget type's own destroy(removed) learned to clear itself, or from a
// kind this dashboard's normal add/remove machinery can't resolve to a
// specific widget instance at all. Confirmed real need: an old encounter/
// soundboard spotlight from earlier testing, left behind by a gap this
// session's own destroy(removed) fixes don't retroactively cover, showed up
// in the panel with no live widget anywhere to toggle it via.
function forceClearSpotlight({ kind, id }) {
  const groupId = groupContext?.groupId;
  if (!groupId) return;
  dataManager
    .clearSpotlight({ groupId, kind, id })
    .catch((error) => status?.show(error.message || "Unable to clear that.", { type: "error" }));
}

// Re-created whenever groupContext changes (boot, and onPinCharacter after a
// campaign switch) — the log being watched depends on which group that is.
// The baseline reset here is what keeps a campaign switch from flourishing
// every already-active item on the new campaign's board as if it just
// arrived.
let spotlightPanelWatcher = null;
function startSpotlightPanelWatcher() {
  spotlightPanelWatcher?.destroy();
  knownActiveSpotlightKeys = new Set();
  lastActiveSpotlights = [];
  spotlightPanelWatcher = watchActiveSpotlights({
    dataManager,
    groupId: groupContext?.groupId || "",
    shareToken: groupContext?.shareToken || shareParam,
    onChange: (active) => refreshSpotlightPanel(active),
  });
}

// Registered once (not re-added on every campaign switch — always reads
// spotlightPanelWatcher fresh via closure) — reacts to THIS tab's own
// dataManager.spotlightToGroup/clearSpotlight calls (data-manager.js's own
// _emit) with an immediate re-fetch, instead of leaving the GM's own "show
// to table" action waiting on the panel's own poll/live-stream cadence to
// notice. Confirmed real complaint: a several-second gap between toggling a
// widget's own visibility and the icon tray reflecting it read as "is this
// even working."
window.addEventListener("undercroft:spotlight-changed", () => {
  spotlightPanelWatcher?.refresh();
});

const params = new URLSearchParams(window.location.search || "");
const encounterParam = params.get("encounter") || "";
const shareParam = params.get("share") || "";
// See the "Second screen" header button — a link back to this exact same
// page, just this one param added, is the whole mechanism (renderScreenView).
const screenMode = params.get("screen") === "1";

let layout = null;
let groupContext = null;
let background = "";
let headerTitleOverride = "";
let pinnedHelpTopics = [];
// Known WLED devices ({ip,label}) — account-wide (GM-tied, not per-widget-
// card or per-suite) via persistSetting, same local+server merge-patch sync
// every other setting on this page uses. Which one a given WLED widget CARD
// is showing/controlling is separate, per-instance state (see that widget's
// own contentRef) — see wled.js's own header comment for the full split.
let wledDevices = [];
let selectedWidgetInstanceId = "";
let editing = false;
const mounted = new Map(); // instanceId -> { destroy() }
// instanceId -> the widget's own already-mounted card element — kept
// separately from `mounted` (which is api/destroy-focused) because
// renderWidgetGrid needs to move these between anchor wrappers on every
// reposition/resize without re-mounting (losing polling/listeners/etc).
const cardElements = new Map();
// zone element -> its own Sortable instance (createSortable, dnd.js), one
// per `[data-grid-zone]" — torn down and rebuilt each time renderWidgetGrid
// runs (see that function's own comment).
const gridZoneRegistry = new Map();

// Built and mounted before the querySelector("[data-*]") lines below query
// for these buttons, so every existing selector/event-listener call site
// elsewhere in this file keeps working unchanged. Dashboard's chrome uses
// its own `btn-dark` color (not the generator tools' outline-secondary/
// primary/success/danger palette) and top-placed tooltips (not the other
// tools' bottom) — both passed as explicit overrides rather than through
// ACTION_PRESETS/kind defaults, which assume the generator-tool convention.
document.querySelector("[data-dashboard-color-reset-mount]")?.appendChild(
  createIconButton({
    icon: "tabler:eraser",
    label: "Reset background",
    variant: "dark",
    kind: "toolbar",
    tooltipPlacement: "top",
    attrs: { "data-dashboard-color-reset": true },
  })
);
// GM-and-above only — a second screen/TV mirror is a table-running tool, not
// something a player-tier account has any use for. Simply never mounted
// below that tier, rather than mounted-but-hidden — screenViewButton (below)
// ends up null for everyone else, and every other reference to it already
// null-checks/optional-chains (updateScreenToggleState's own early return,
// the click listener's `?.`), so nothing else needs to change to accommodate
// that.
if (dataManager.meetsTier("gm")) {
  document.querySelector("[data-dashboard-screen-toggle-mount]")?.appendChild(
    createIconButton({
      icon: "tabler:device-tv",
      label: "Open a live, read-only mirror of whatever's currently shown to the table — for a physical second screen/TV",
      variant: "dark",
      kind: "toolbar",
      tooltipPlacement: "top",
      attrs: { "data-dashboard-screen-toggle": true },
    })
  );
}
document.querySelector("[data-widget-inspector-toolbar-mount]")?.appendChild(
  createIconButton({
    icon: "tabler:trash",
    label: "Remove widget",
    variant: "outline-danger",
    kind: "toolbar",
    tooltipPlacement: "top",
    attrs: { "data-widget-inspector-remove": true },
  })
);

const dashboardShellEl = document.querySelector("[data-dashboard-shell]");
const screenRootEl = document.querySelector("[data-dashboard-screen-root]");
const mainEl = document.querySelector("[data-dashboard-main]");
const titleDisplay = document.querySelector("[data-dashboard-title-display]");
const titleInput = document.querySelector("[data-dashboard-title-input]");
const gridEl = document.querySelector("[data-dashboard-grid]");
const welcomeEl = document.querySelector("[data-dashboard-welcome]");
const editToggle = document.querySelector("[data-dashboard-edit-toggle]");
const layoutTools = document.querySelector("[data-dashboard-layout-tools]");
const addToolbar = document.querySelector("[data-dashboard-add-toolbar]");
const colorInput = document.querySelector("[data-dashboard-color-input]");
const colorReset = document.querySelector("[data-dashboard-color-reset]");
const gridColumnsInput = document.querySelector("[data-dashboard-grid-columns-input]");
const gridRowsInput = document.querySelector("[data-dashboard-grid-rows-input]");
if (gridColumnsInput) {
  gridColumnsInput.min = String(GRID_COLUMN_COUNT_MIN);
  gridColumnsInput.max = String(GRID_COLUMN_COUNT_MAX);
}
if (gridRowsInput) {
  gridRowsInput.min = String(GRID_ROW_COUNT_MIN);
  gridRowsInput.max = String(GRID_ROW_COUNT_MAX);
}
const screenViewButton = document.querySelector("[data-dashboard-screen-toggle]");
const leftPane = document.querySelector('[data-pane="left"]');
const leftPaneToggle = document.querySelector('[data-pane-toggle="left"]');
const widgetInspectorEmpty = document.querySelector("[data-widget-inspector-empty]");
const widgetInspectorDetails = document.querySelector("[data-widget-inspector-details]");
const widgetInspectorType = document.querySelector("[data-widget-inspector-type]");
const widgetInspectorBody = document.querySelector("[data-widget-inspector-body]");
const widgetInspectorRemove = document.querySelector("[data-widget-inspector-remove]");

function allWidgetTypes() {
  return layout.widgets.map((instance) => instance.widgetType);
}

function findInstance(instanceId) {
  return layout.widgets.find((instance) => instance.instanceId === instanceId) || null;
}

// The one instance-mutating operation besides add/remove — lets a widget
// with no Library kind of its own (Clock) persist a change to its own
// contentRef in place, without needing to remove-and-re-add itself. Doesn't
// re-render the widget itself (the caller already knows its own new state
// and renders accordingly) — just keeps the layout's own persisted copy in
// sync so a reload doesn't lose it.
function updateInstanceContentRef(instanceId, contentRef) {
  const instance = findInstance(instanceId);
  if (!instance) return;
  instance.contentRef = contentRef;
  persistLayout();
}

function createWidgetCard(instance, label) {
  const card = el("div", "card shadow-theme dashboard-widget-card");
  card.dataset.widgetInstanceId = instance.instanceId;
  card.dataset.widgetType = instance.widgetType;
  const body = el("div", "card-body d-flex flex-column gap-2");
  // CSS Grid stretches this card to fill its own colSpan/rowSpan footprint
  // by default (align-items: stretch) — min-height:0 down this whole chain
  // (body here, mount below) is what lets a widget that wants to actually
  // fill that footprint (forcePlayerView Map/journal Handout, Combat
  // Tracker, Clock) do so via its own `flex: 1 1 0`, instead of the flex
  // column refusing to shrink below its content's natural height and
  // overflowing the grid cell.
  body.style.minHeight = "0";
  const header = el("div", "d-flex justify-content-between align-items-center gap-2");
  header.dataset.widgetHeader = "";
  // Holds an optional per-widget action button (e.g. Character sheet's "Open
  // in Workbench") to the left of the title — see setHeaderAction in
  // mountWidget below. Title lives in here too (not a header-level sibling)
  // so the action button reads as "attached to the title," not floating
  // separately from the remove button on the header's other side.
  const leftGroup = el("div", "d-flex align-items-center gap-2");
  const titleEl = el("h3", "h6 mb-0", label);
  leftGroup.appendChild(titleEl);
  header.appendChild(leftGroup);
  // header is `justify-content-between` — that only pushes its two ENDS
  // apart; with 3+ direct children it spreads space between EVERY adjacent
  // pair equally, which is exactly what put Game Log's Clear-log button in
  // the middle instead of snug against Remove. Grouping every right-side
  // button (Remove, plus any setRightAction button — see mountWidget) inside
  // this one rightGroup keeps header itself down to just two children
  // (leftGroup, rightGroup), so space-between only ever separates those two,
  // while rightGroup's own small gap keeps its own buttons adjacent.
  const rightGroup = el("div", "d-flex align-items-center gap-2");
  // `invisible` (visibility:hidden), not `d-none` — the button still occupies
  // its box even when not editing, so the header's height (and everything
  // below it) never shifts the instant edit mode is toggled on.
  const removeButton = el("button", "btn btn-sm btn-outline-danger invisible");
  removeButton.type = "button";
  removeButton.dataset.widgetRemove = "";
  const removeIcon = el("span", "iconify");
  removeIcon.dataset.icon = "tabler:x";
  removeIcon.setAttribute("aria-hidden", "true");
  removeButton.appendChild(removeIcon);
  removeButton.addEventListener("click", (event) => {
    // Stop this from also bubbling into the delegated selection listener on
    // gridEl — the card is about to be torn down, selecting it first would
    // just be immediately undone.
    event.stopPropagation();
    if (selectedWidgetInstanceId === instance.instanceId) selectWidget("");
    removeWidget(instance.instanceId);
  });
  rightGroup.appendChild(removeButton);
  header.appendChild(rightGroup);
  // flex-grow-1 + min-height:0 — see body's own comment above; this is what
  // actually lets a forcePlayerView widget's own `flex: 1 1 0` content fill
  // the rest of the card's grid-stretched height. overflowY:auto — the grid
  // gives every card a FIXED height (colSpan/rowSpan-driven) rather than
  // letting it grow to fit content the way the old flex-column layout did;
  // content taller than that needs to scroll within mount instead of
  // spilling past the card's visible boundary (confirmed directly: a
  // Character sheet's notes field rendered outside the card box without
  // this). Scoped to mount, not the whole card-body, so the header stays
  // pinned in view rather than scrolling away with the content.
  const mount = el("div", "d-flex flex-column flex-grow-1");
  mount.style.minHeight = "0";
  mount.style.overflowY = "auto";
  body.append(header, mount);
  card.appendChild(body);
  // A drag-to-resize handle in the card's bottom-right corner — the standard
  // convention. Native pointer events, not SortableJS — SortableJS only does
  // list reordering, resizing is a different interaction entirely and
  // there's no single helper in this codebase (or really anywhere) that does
  // both. Hidden unless editing (plain inline style.display, not the
  // .d-none/.d-flex Bootstrap utility classes used elsewhere in this file —
  // those carry !important, and this toggles often enough that inline keeps
  // it unambiguous). Absolutely positioned against `card` itself (not
  // `mount`, which scrolls) so it stays pinned to the actual corner.
  card.style.position = "relative";
  const resizeHandle = el("div");
  resizeHandle.style.display = "none";
  resizeHandle.dataset.widgetResizeHandle = "";
  resizeHandle.setAttribute("role", "presentation");
  resizeHandle.setAttribute("aria-label", `Resize ${label}`);
  resizeHandle.style.position = "absolute";
  resizeHandle.style.right = "0";
  resizeHandle.style.bottom = "0";
  resizeHandle.style.width = "1.1rem";
  resizeHandle.style.height = "1.1rem";
  resizeHandle.style.cursor = "nwse-resize";
  resizeHandle.style.touchAction = "none";
  resizeHandle.style.zIndex = "5";
  resizeHandle.style.background =
    "linear-gradient(135deg, transparent 0 42%, var(--bs-border-color) 42% 54%, transparent 54% 100%)," +
    "linear-gradient(135deg, transparent 0 66%, var(--bs-border-color) 66% 78%, transparent 78% 100%)";
  card.appendChild(resizeHandle);
  return { card, header, resizeHandle, mount, removeButton, titleEl, leftGroup, rightGroup };
}

function buildCtx(instance, { setTitle, setHeaderAction, setRightAction } = {}) {
  return {
    dataManager,
    status,
    layout,
    groupContext,
    encounterParam,
    shareParam,
    onPinCharacter,
    onToggleSpotlight: toggleSpotlightItem,
    // Deliberately no fallback icon here (unlike refreshSpotlightPanel's own
    // resolution above) — undefined is exactly the signal game-log.js uses
    // to know a kind isn't recognized and render its icon as plain/non-
    // interactive instead of a dead click target (mirrors the old toast's
    // own findCatalogEntry gate, which the log's Accept button never had).
    resolveSpotlightKindIcon: (kind) => findCatalogEntry(KIND_WIDGET_MAP[kind])?.icon,
    isSpotlightOnDashboard: isSpotlightItemOnMyDashboard,
    ensureSpotlightTitleCached: ensureTitleCached,
    getCachedSpotlightTitle: (kind, id) => titleCache.get(`${kind}:${id}`) || "",
    instanceId: instance?.instanceId || "",
    contentRef: instance?.contentRef || null,
    // Lets a widget with no Library kind of its own (Clock) persist its own
    // small bit of local state directly into this instance's contentRef slot
    // — the same generic per-instance storage Map/Card use for "which record
    // to show," just repurposed here since there's no record to reference.
    setContentRef: (next) => updateInstanceContentRef(instance?.instanceId, next),
    setTitle: setTitle || (() => {}),
    setHeaderAction: setHeaderAction || (() => {}),
    setRightAction: setRightAction || (() => {}),
    // True only inside the second-screen mirror window (renderScreenView) —
    // every widget type that has its own "show to table" visibility toggle
    // reads this to always render its player-safe view there, regardless of
    // who actually opened the mirror (a GM opening it for the table's own TV
    // should see the same restricted view everyone else at the table sees).
    forcePlayerView: screenMode,
    // An alternate, never-zoomed mount point — set per-instance by
    // mountWidget only for Handout (the one widget type where only SOME of
    // what it renders — Press-templated cards, not journal pages — conflicts
    // with a CSS zoom; see ZOOM_EXCLUDED_WIDGET_TYPES's own comment). null
    // for every other widget type.
    plainMountContainer: null,
    // Only meaningful as the value *at mount time* — dashboard.js never
    // remounts a widget just because edit mode toggled (see editToggle's own
    // handler, which only calls applyEditingState()), so a widget that needs
    // to react LIVE to later toggles (Map's zoom panel) has to expose a DOM
    // hook applyEditingState can find and flip itself, using this only for
    // the initial state.
    editing,
    // A live-read counterpart to `editing` above, for the rarer case of a
    // widget that needs the CURRENT value at some later moment (a click
    // handler), not just its value at mount time — a plain closure over the
    // same `let editing`, so calling it always reads whatever's true right
    // now regardless of when ctx was built. See board.js's own use
    // (deciding whether a macro-button card runs the macro or opens it in
    // Loom).
    isEditing: () => editing,
  };
}

// `screenMode` — mounted into the second-screen mirror's own grid
// (renderScreenView) instead of the GM's own editable dashboard grid: no
// remove button, no drag handle, no selection outline, no resize handle, no
// zoom controls (the mirror only ever displays whatever arrangement the GM
// already built in Edit layout — see buildCtx's own forcePlayerView, which
// this flag also drives). For the real dashboard (not screenMode), this
// builds the card and its content but does NOT place it in the grid or
// append it anywhere — `cardElements` records it, and renderWidgetGrid is
// what actually positions every card (into its own explicit col/row anchor)
// and builds the empty-cell drop zones around them; see that function's own
// comment for why placement is a separate pass now.
function mountWidget(instance, { screenMode: isScreenCard = false } = {}) {
  const entry = findCatalogEntry(instance.widgetType);
  if (!entry || (isScreenCard && !screenGridEl) || (!isScreenCard && !gridEl)) return;
  const { card, header, resizeHandle, mount, removeButton, titleEl, leftGroup, rightGroup } = createWidgetCard(
    instance,
    entry.label
  );
  if (isScreenCard) {
    removeButton.remove();
    resizeHandle.remove();
    card.style.gridColumn = `${instance.col + 1} / span ${instance.colSpan}`;
    card.style.gridRow = `${instance.row + 1} / span ${instance.rowSpan}`;
    // Starts hidden — renderScreenView's own visibility poll unhides it the
    // moment it confirms this instance is actually spotlighted, avoiding a
    // flash of every eligible widget before that first check resolves.
    card.classList.add("d-none");
    screenGridEl.appendChild(card);
  } else {
    if (editing) header.setAttribute("data-sortable-handle", "");
    removeButton.classList.toggle("invisible", !editing);
    // renderWidgets() destroys and rebuilds every card from scratch (e.g.
    // after onPinCharacter) — restore the selection outline on whichever
    // card still matches the currently-selected instance, since it's a
    // fresh DOM node.
    if (instance.instanceId === selectedWidgetInstanceId) card.setAttribute("data-widget-selected", "true");
    cardElements.set(instance.instanceId, card);
  }
  // Handout is the one widget type whose own content KIND decides, at
  // render time, whether zoom is safe (a journal page — plain flow, zoom is
  // fine) or not (a Press-templated card — its own JS-measurement scale-to-
  // fit conflicts with CSS zoom, same as Map). It always gets both a zoomed
  // wrapper and a never-zoomed sibling — handout.js itself picks which one
  // to actually render into (see its own plainMountContainer/renderTarget
  // comment) — every other widget type just mounts straight into `mount`.
  const isHandout = instance.widgetType === "handout";
  let zoomTargetEl = mount;
  let plainMountEl = null;
  if (isHandout) {
    const zoomWrap = el("div", "d-flex flex-column flex-grow-1");
    zoomWrap.style.minHeight = "0";
    const plainWrap = el("div", "d-none flex-column flex-grow-1");
    plainWrap.style.minHeight = "0";
    mount.append(zoomWrap, plainWrap);
    zoomTargetEl = zoomWrap;
    plainMountEl = plainWrap;
  }
  const isPressCard = isHandout && instance.contentRef?.kind && instance.contentRef.kind !== "journal";
  const skipZoom = ZOOM_EXCLUDED_WIDGET_TYPES.has(instance.widgetType) || isPressCard;
  // Marks the actual zoom target on the DOM itself (only when zoom is
  // meaningful for this instance at all) — the GM's own zoom stepper
  // buttons don't need this (they close over zoomTargetEl directly), but
  // the second-screen mirror does: its own refresh loop (renderScreenView)
  // has to re-apply a changed zoom to an ALREADY-mounted card from outside
  // mountWidget entirely, with no closure to call, since re-fetching the
  // GM's layout on a poll is the only way it learns the value changed.
  if (!skipZoom) zoomTargetEl.dataset.widgetZoomTarget = "";
  const applyZoom = () => {
    if (skipZoom) return;
    zoomTargetEl.style.zoom = `${instance.zoom}%`;
  };
  applyZoom();
  if (!isScreenCard) {
    // Initial visibility at mount time — matches editing's CURRENT value,
    // same as removeButton's own toggle just above. Later toggles (the user
    // clicking Edit layout without a full re-mount) go through
    // applyEditingState instead.
    resizeHandle.style.display = editing ? "block" : "none";
    const buildIconButton = (iconName, label, onClick) => {
      const button = el("button", "btn btn-outline-secondary");
      button.type = "button";
      button.setAttribute("aria-label", label);
      button.dataset.bsToggle = "tooltip";
      button.dataset.bsPlacement = "top";
      button.dataset.bsTitle = label;
      const iconEl = el("span", "iconify");
      iconEl.dataset.icon = iconName;
      iconEl.setAttribute("aria-hidden", "true");
      button.appendChild(iconEl);
      button.addEventListener("click", onClick);
      return button;
    };
    // Resizing only ever changes colSpan/rowSpan on the anchor wrapper
    // renderWidgetGrid put this card inside (card.parentElement) — the card
    // itself just fills that wrapper at 100%/100% (shell.css). Live-updates
    // during the drag for visual feedback; a full renderWidgetGrid() only
    // happens once, on release (see onResizePointerUp), since resizing can
    // change which cells are free and the empty-zone layer needs to reflect
    // that — doing that mid-drag on every pointermove would be constantly
    // destroying/recreating the very Sortable instance the drag is using.
    const applyGridSpan = () => {
      const anchor = card.parentElement;
      if (!anchor) return;
      anchor.style.gridColumn = `${instance.col + 1} / span ${instance.colSpan}`;
      anchor.style.gridRow = `${instance.row + 1} / span ${instance.rowSpan}`;
    };
    // Drag-to-resize — grab the handle, move the pointer, release. Reads the
    // grid's own actual computed cell size (not a hardcoded guess) so it
    // stays correct regardless of viewport width, column count, or CSS
    // changes: cell width from the grid's own rendered box divided by the
    // CURRENT column count, cell height from the grid's own computed
    // `grid-auto-rows`. Snaps to whole
    // cells/rows (Math.round). setPointerCapture means the drag keeps
    // tracking even if the pointer strays off the small handle element
    // mid-drag.
    let resizeStartX = 0;
    let resizeStartY = 0;
    let resizeStartColSpan = instance.colSpan;
    let resizeStartRowSpan = instance.rowSpan;
    const onResizePointerMove = (event) => {
      if (!gridEl) return;
      const columnCount = getColumnCount();
      const gridStyles = getComputedStyle(gridEl);
      const gap = parseFloat(gridStyles.columnGap) || 0;
      const rowHeight = parseFloat(gridStyles.gridAutoRows) || 1;
      const cellWidth = (gridEl.getBoundingClientRect().width - gap * (columnCount - 1)) / columnCount;
      const deltaCols = Math.round((event.clientX - resizeStartX) / (cellWidth + gap));
      const deltaRows = Math.round((event.clientY - resizeStartY) / (rowHeight + gap));
      // Max bound is columnCount/rowCount minus the widget's own fixed
      // col/row anchor, not the raw grid size — resizing never moves the
      // anchor, so a widget starting at col 5 of an 8-wide grid can only
      // grow to colSpan 3, not 8.
      instance.colSpan = clampInt(
        resizeStartColSpan + deltaCols,
        COL_SPAN_MIN,
        columnCount - instance.col,
        resizeStartColSpan
      );
      instance.rowSpan = clampInt(
        resizeStartRowSpan + deltaRows,
        ROW_SPAN_MIN,
        getRowCount() - instance.row,
        resizeStartRowSpan
      );
      applyGridSpan();
    };
    const onResizePointerUp = (event) => {
      resizeHandle.removeEventListener("pointermove", onResizePointerMove);
      resizeHandle.removeEventListener("pointerup", onResizePointerUp);
      try {
        resizeHandle.releasePointerCapture(event.pointerId);
      } catch (error) {
        // Capture may already be gone (e.g. pointercancel) — nothing to do.
      }
      persistLayout();
      renderWidgetGrid();
    };
    resizeHandle.addEventListener("pointerdown", (event) => {
      // Stop this from also triggering the card's own click-to-select
      // listener (gridEl's delegated click handler) once the drag ends.
      event.preventDefault();
      event.stopPropagation();
      resizeStartX = event.clientX;
      resizeStartY = event.clientY;
      resizeStartColSpan = instance.colSpan;
      resizeStartRowSpan = instance.rowSpan;
      resizeHandle.setPointerCapture(event.pointerId);
      resizeHandle.addEventListener("pointermove", onResizePointerMove);
      resizeHandle.addEventListener("pointerup", onResizePointerUp);
    });
    // Zoom controls — in the header, next to the visibility toggle (if this
    // widget type has one — see setRightAction below), not with the resize
    // handle. These are view-mode controls (adjusting how YOU see the
    // widget on YOUR OWN screen), the opposite gating sense from
    // resizeHandle/editing: visible only OUTSIDE Edit layout, hidden while
    // editing. Skipped entirely for widget types/content where zoom does
    // nothing (skipZoom — Map, and Handout showing a Press-templated card).
    if (!skipZoom) {
      const zoomGroup = el("div", "btn-group btn-group-sm");
      zoomGroup.dataset.widgetZoomControls = "";
      zoomGroup.style.display = editing ? "none" : "inline-flex";
      zoomGroup.append(
        buildIconButton("tabler:zoom-out", "Zoom out", () => {
          instance.zoom = Math.max(ZOOM_MIN, instance.zoom - ZOOM_STEP);
          applyZoom();
          persistLayout();
        }),
        buildIconButton("tabler:zoom-reset", "Reset zoom", () => {
          instance.zoom = DEFAULT_ZOOM;
          applyZoom();
          persistLayout();
        }),
        buildIconButton("tabler:zoom-in", "Zoom in", () => {
          instance.zoom = Math.min(ZOOM_MAX, instance.zoom + ZOOM_STEP);
          applyZoom();
          persistLayout();
        })
      );
      rightGroup.insertBefore(zoomGroup, removeButton);
      if (!editing) refreshTooltips(zoomGroup);
    }
  }
  // Lets a widget put a single icon-button action (e.g. Character sheet's
  // "Open in Workbench") to the left of its own title — pass null to clear
  // it. Disposes/re-arms the button's own Bootstrap tooltip around the swap,
  // same "dynamic DOM needs a rescan" reasoning as populateAddToolbar.
  let headerActionEl = null;
  const setHeaderAction = (action) => {
    if (headerActionEl) {
      disposeTooltips(header);
      headerActionEl.remove();
      headerActionEl = null;
    }
    if (!action) return;
    const button = document.createElement(action.href ? "a" : "button");
    button.className = "btn btn-outline-secondary btn-sm p-1 d-inline-flex align-items-center justify-content-center";
    if (action.href) {
      button.href = action.href;
    } else {
      button.type = "button";
      button.addEventListener("click", () => action.onClick?.());
    }
    button.dataset.bsToggle = "tooltip";
    button.dataset.bsPlacement = "top";
    button.dataset.bsTitle = action.tooltip || "";
    const actionIcon = document.createElement("span");
    actionIcon.className = "iconify";
    actionIcon.dataset.icon = action.icon;
    actionIcon.setAttribute("aria-hidden", "true");
    button.appendChild(actionIcon);
    leftGroup.insertBefore(button, titleEl);
    headerActionEl = button;
    refreshTooltips(header);
  };
  // The right-side counterpart — always inserted into rightGroup BEFORE
  // Remove (not header directly: see createWidgetCard's own comment — header
  // is justify-content-between, which spreads space between EVERY adjacent
  // child once there are 3+, which is what put a right-side action in the
  // middle instead of snug against Remove when this was header-level).
  // Always visible regardless of edit mode (a visibility toggle needs to
  // work while just viewing the dashboard, not only while editing layout),
  // and — same size as Remove (`btn-sm`) per that convention — Remove has to
  // actually leave the layout (`d-none`, not the usual `invisible`) while
  // hidden, or its reserved space would keep this action pinned one slot
  // short of rightGroup's true edge instead of shifting into Remove's place.
  // Widgets that never call this keep Remove's original invisible-but-
  // space-reserving behavior, so their header height still never shifts on
  // edit-toggle.
  let rightActionEl = null;
  const setRightAction = (action) => {
    if (rightActionEl) {
      disposeTooltips(rightGroup);
      rightActionEl.remove();
      rightActionEl = null;
    }
    if (!action) {
      delete removeButton.dataset.widgetRemoveCollapsible;
      removeButton.classList.remove("d-none");
      removeButton.classList.toggle("invisible", !editing);
      return;
    }
    removeButton.dataset.widgetRemoveCollapsible = "";
    removeButton.classList.remove("invisible");
    removeButton.classList.toggle("d-none", !editing);
    // `active` — Map/Handout/Combat Tracker/Clock's own visibility toggles
    // pass this when the thing they're attached to is currently shown to the
    // table. A SOLID primary fill (not just an outline) is deliberate here —
    // this needs to read as "on" at a glance, not just on close inspection,
    // since it's the one place the whole dashboard shows what the table can
    // currently see.
    const button = el("button", `btn btn-sm ${action.active ? "btn-primary" : "btn-outline-secondary"}`);
    button.type = "button";
    button.dataset.bsToggle = "tooltip";
    button.dataset.bsPlacement = "top";
    button.dataset.bsTitle = action.tooltip || "";
    const actionIcon = el("span", "iconify");
    actionIcon.dataset.icon = action.icon;
    actionIcon.setAttribute("aria-hidden", "true");
    button.appendChild(actionIcon);
    button.addEventListener("click", () => action.onClick?.());
    rightGroup.insertBefore(button, removeButton);
    rightActionEl = button;
    refreshTooltips(rightGroup);
  };
  // Lets a widget suffix its own card header with whatever it's actually
  // showing (e.g. "Map - Sharn", "Character sheet - Octavian Hoff") once it
  // knows — map.js/character-summary.js call this once their data loads.
  const setTitle = (suffix) => {
    titleEl.textContent = suffix ? `${entry.label} - ${suffix}` : entry.label;
  };
  // A screen-mirror card has no header at all beyond the title (no remove
  // button ever mounted — see the .remove() call above) — nothing for a
  // widget's own header/right-side action to attach to, so these are no-ops
  // there rather than touching a detached removeButton.
  const ctx = buildCtx(instance, {
    setTitle,
    setHeaderAction: isScreenCard ? () => {} : setHeaderAction,
    setRightAction: isScreenCard ? () => {} : setRightAction,
  });
  if (isHandout) ctx.plainMountContainer = plainMountEl;
  const api = entry.init(zoomTargetEl, ctx) || { destroy() {} };
  mounted.set(instance.instanceId, api);
}

// "What's currently shown to the table" for one instance — the spotlight
// system (spotlight.js's resolveActiveSpotlightId) is scoped per
// (groupId, kind), not per widget instance, so each widget type needs its
// own comparison against what it itself spotlights when its eye icon is
// toggled on (see handout.js/map.js/clocks.js/combat-tracker.js's own
// dataManager.spotlightToGroup calls for the kind/contentId each uses).
async function isInstanceSpotlighted(instance) {
  const groupId = groupContext?.groupId || "";
  const shareToken = groupContext?.shareToken || shareParam;
  switch (instance.widgetType) {
    case "handout": {
      const kind = instance.contentRef?.kind;
      const id = instance.contentRef?.id;
      if (!kind || !id) return false;
      // Per-instance, not just per-kind — two Handouts of the same kind
      // (two NPCs) must show/hide independently, same as the widget's own
      // eye-icon toggle now checks (handout.js's refreshVisibility) — see
      // resolveIsSpotlighted's own comment.
      return resolveIsSpotlighted(dataManager, { groupId, shareToken, kind, id });
    }
    case "map": {
      const id = instance.contentRef?.id;
      if (!id) return false;
      return resolveIsSpotlighted(dataManager, { groupId, shareToken, kind: "map", id });
    }
    case "clock":
      return resolveIsSpotlighted(dataManager, { groupId, shareToken, kind: "clock", id: instance.instanceId });
    case "browser":
      return resolveIsSpotlighted(dataManager, { groupId, shareToken, kind: "browser", id: instance.instanceId });
    case "calendar":
      return resolveIsSpotlighted(dataManager, { groupId, shareToken, kind: "calendar", id: instance.instanceId });
    case "soundboard":
      return resolveIsSpotlighted(dataManager, { groupId, shareToken, kind: "soundboard", id: instance.instanceId });
    case "combat":
      // AUTO_DISCOVER — same as combat-tracker.js's own resolution: any
      // active encounter at all means "show it," not a specific id match
      // (Combat Tracker is `multiple: false` — only one instance can ever
      // exist on a dashboard, so there's no same-kind collision to worry
      // about here the way there is for Handout/Map/Clock).
      return Boolean(await resolveActiveSpotlightId(dataManager, { groupId, shareToken, kind: "encounter" }));
    default:
      return false;
  }
}

let screenGridEl = null;
let screenPollTimer = null;
let screenInstances = [];

// The second-screen mirror's own boot path (see boot()'s own screenMode
// branch) — reuses mountWidget/buildCtx exactly like the GM's own dashboard
// does, just: (a) filtered to TABLE_WIDGET_TYPES (character/gamelog/
// diceroller have no "shown to table" concept, so never appear here), (b)
// every mounted instance is a screenMode card (no remove/drag/size
// controls — see mountWidget's own isScreenCard branches), and (c) a
// background poll both toggles each card's own d-none based on whether it's
// currently spotlighted AND re-fetches the GM's own layout to catch
// add/remove/reposition/resize made after this window opened — this window
// is a completely separate JS realm from the dashboard tab actually being
// edited (window.open, not a shared in-page render), so polling the same
// persisted layout the GM's own edits write to is the only way to learn
// about those (confirmed directly: without this, resizing/moving a widget
// on the GM's own dashboard never showed up here, even once already-visible
// content kept updating live via each widget's own separate polling).
function renderScreenView() {
  dashboardShellEl?.classList.add("d-none");
  if (!screenRootEl) return;
  screenRootEl.classList.remove("d-none");
  screenRootEl.classList.add("d-flex");
  document.title = "Second screen — Undercroft";
  screenGridEl = el("div", "dashboard-grid flex-grow-1");
  screenGridEl.style.setProperty("--dashboard-grid-columns", String(getColumnCount()));
  screenRootEl.appendChild(screenGridEl);
  screenInstances = layout.widgets.filter((instance) => TABLE_WIDGET_TYPES.has(instance.widgetType));
  screenInstances.forEach((instance) => mountWidget(instance, { screenMode: true }));

  const refreshScreen = async () => {
    const serverSettings = await loadServerSettings();
    layout = await loadLayout(serverSettings);
    screenGridEl.style.setProperty("--dashboard-grid-columns", String(getColumnCount()));
    const freshInstances = layout.widgets.filter((instance) => TABLE_WIDGET_TYPES.has(instance.widgetType));
    const freshById = new Map(freshInstances.map((instance) => [instance.instanceId, instance]));
    const previousById = new Map(screenInstances.map((instance) => [instance.instanceId, instance]));

    // Unmount anything removed (or no longer table-eligible) since the last
    // poll — the one place this window ever tears a widget down for good.
    screenInstances.forEach((instance) => {
      if (freshById.has(instance.instanceId)) return;
      mounted.get(instance.instanceId)?.destroy?.();
      mounted.delete(instance.instanceId);
      screenGridEl?.querySelector(`[data-widget-instance-id="${instance.instanceId}"]`)?.remove();
    });
    // Re-mount anything whose own content changed (a Browser widget's URL
    // is the one case this matters for today — every OTHER widget type's
    // contentRef never changes after it's first added). A widget's own
    // render() only ever runs against the contentRef it was mounted with —
    // a plain reposition/re-zoom pass below wouldn't pick up a content
    // change on its own, it would just keep showing whatever URL was
    // current the moment this window opened.
    screenInstances.forEach((instance) => {
      const fresh = freshById.get(instance.instanceId);
      if (!fresh || JSON.stringify(fresh.contentRef) === JSON.stringify(instance.contentRef)) return;
      mounted.get(instance.instanceId)?.destroy?.();
      mounted.delete(instance.instanceId);
      screenGridEl?.querySelector(`[data-widget-instance-id="${instance.instanceId}"]`)?.remove();
      mountWidget(fresh, { screenMode: true });
    });
    // Mount anything newly added — already gets the CURRENT position/size,
    // so no separate reposition step needed for these.
    freshInstances.forEach((instance) => {
      if (!previousById.has(instance.instanceId)) mountWidget(instance, { screenMode: true });
    });
    // Reposition/resize/re-zoom whatever already existed both before and
    // after — cheap style updates only, never a remount (which would drop
    // that widget's own live polling/state for no reason; the content-change
    // pass above already handled the one case that DOES need a remount).
    freshInstances.forEach((instance) => {
      if (!previousById.has(instance.instanceId)) return;
      const card = screenGridEl?.querySelector(`[data-widget-instance-id="${instance.instanceId}"]`);
      if (!card) return;
      card.style.gridColumn = `${instance.col + 1} / span ${instance.colSpan}`;
      card.style.gridRow = `${instance.row + 1} / span ${instance.rowSpan}`;
      // Only present at all when zoom is meaningful for this instance (see
      // mountWidget's own data-widget-zoom-target comment) — Map and a
      // Press-templated Handout card never get one, so this is a no-op there.
      const zoomTarget = card.querySelector("[data-widget-zoom-target]");
      if (zoomTarget) zoomTarget.style.zoom = `${instance.zoom}%`;
    });
    screenInstances = freshInstances;

    await Promise.all(
      screenInstances.map(async (instance) => {
        const card = screenGridEl?.querySelector(`[data-widget-instance-id="${instance.instanceId}"]`);
        if (!card) return;
        const shown = await isInstanceSpotlighted(instance);
        card.classList.toggle("d-none", !shown);
      })
    );
  };
  void refreshScreen();
  screenPollTimer = createReliableInterval(() => void refreshScreen(), 5000);
}

// Positions every already-mounted widget card into the grid and — while
// editing — builds the empty-cell drop zones around them, wiring the whole
// thing up as one big SortableJS group (createSortable, dnd.js — one
// instance per zone, not dnd.js's own initSortableGroup/setupDropzones
// helpers, since both of those also treat their own root element as an
// extra zone, which here would make gridEl itself a Sortable list nested
// one level above the per-widget zones — see below) so a widget can be
// dragged to ANY open cell, not just reordered in a list. This is a
// deliberately different architecture from the old single-list/auto-flow
// approach: SortableJS fundamentally reasons about ordering within ONE
// list, but a real 2D grid needs to know WHICH cell a drop landed on — the
// standard way to get that out of SortableJS is many small lists sharing one
// group (exactly what the original 3-column layout already did, just
// generalized from 3 columns to every individual cell). Concretely:
//   - Every widget gets its own "anchor" wrapper, spanning its own
//     colSpan/rowSpan, holding its card as the sole child.
//   - Every OTHER (empty) cell gets its own 1x1 "zone" wrapper.
//   - Both anchors and zones are Sortable "lists" in the same group — a
//     drag moves the card's DOM node from its anchor into whichever
//     zone/anchor it's dropped on. onMove rejects dropping onto a
//     non-empty target (no swap/overlap semantics — only genuinely open
//     cells accept a drop); onEnd reads the target's own col/row dataset
//     and writes it onto the instance, then re-renders.
// True only for a genuinely fresh, never-signed-in, never-customized visit
// — NOT just "not signed in" on its own, which would also cover an
// anonymous visitor who's already built their own local-only dashboard
// (layout.widgets loaded straight from local storage — see loadLayout).
// That dashboard is exactly what "many of the tools are free and don't
// require a login at all" means in practice; showing a marketing screen
// over top of it every visit would be actively hostile to that use case.
function shouldShowWelcomeScreen() {
  return !dataManager.isAuthenticated() && layout.widgets.length === 0;
}

// Plain sibling content (welcomeEl, index.html), not widget cards inside
// gridEl — see that element's own comment. Rebuilt fresh each time
// renderWidgetGrid shows it; cheap enough (a handful of static cards) not
// to bother diffing against whatever's already there.
function renderWelcomeScreen() {
  if (!welcomeEl) return;
  welcomeEl.innerHTML = "";
  welcomeEl.innerHTML = `
    <div class="d-flex flex-column gap-2" style="max-width: 48rem;">
      <p class="fs-5 mb-0">
        Undercroft is a suite of connected tools for running and playing tabletop campaigns —
        build character sheets and rules systems, manage your whole campaign library, draw and
        run interactive maps, write your world's lore, print sheets and cards, and more, all
        designed to work together instead of as separate apps.
      </p>
    </div>
    <div class="row row-cols-1 row-cols-md-3 g-3" style="max-width: 64rem;">
      <div class="col">
        <div class="card h-100 shadow-theme">
          <div class="card-body d-flex flex-column gap-2">
            <span class="iconify fs-2 text-primary" data-icon="tabler:stack-2" aria-hidden="true"></span>
            <h3 class="h6 mb-0">A connected toolbox</h3>
            <p class="small text-body-secondary mb-0">
              Workbench for character sheets, Loom for your campaign library, Orrery for maps,
              Repository for journals, Press for printing — content made in one tool is
              immediately usable in the others.
            </p>
          </div>
        </div>
      </div>
      <div class="col">
        <div class="card h-100 shadow-theme">
          <div class="card-body d-flex flex-column gap-2">
            <span class="iconify fs-2 text-success" data-icon="tabler:lock-open" aria-hidden="true"></span>
            <h3 class="h6 mb-0">Free to use, no account needed</h3>
            <p class="small text-body-secondary mb-0">
              Most tools work right now, right here — your work saves locally in this browser.
              Registering is entirely optional, not a requirement to get started.
            </p>
          </div>
        </div>
      </div>
      <div class="col">
        <div class="card h-100 shadow-theme">
          <div class="card-body d-flex flex-column gap-2">
            <span class="iconify fs-2 text-info" data-icon="tabler:users-group" aria-hidden="true"></span>
            <h3 class="h6 mb-0">Why register anyway?</h3>
            <p class="small text-body-secondary mb-0">
              An account syncs your work across devices, lets you share your table's campaign
              (game log, spotlighted content, live maps) with your players, and unlocks GM-tier
              tools like the Combat Tracker and campaign groups.
            </p>
          </div>
        </div>
      </div>
    </div>
    <button type="button" class="btn btn-primary align-self-start" data-dashboard-welcome-auth>
      Login / Register
    </button>
  `;
  const ctaButton = welcomeEl.querySelector("[data-dashboard-welcome-auth]");
  if (ctaButton) {
    // Reuses the header's own auth control (app-shell.js's initAppShell +
    // auth-ui.js's initAuthControls, already mounted by the time boot()
    // reaches this) rather than a second, separate way to open the same
    // modal.
    ctaButton.addEventListener("click", () => {
      document.querySelector("[data-auth-control] button")?.click();
    });
  }
}

// Called after every mount, add, remove, resize-release, and editing
// toggle — always a full rebuild of the zone/anchor structure, but NEVER
// re-mounts a widget's own card (see cardElements — the same DOM node just
// moves to a new parent), so no widget ever loses its live polling/state
// over a reposition.
function renderWidgetGrid() {
  if (!gridEl) return;
  const showWelcome = shouldShowWelcomeScreen();
  gridEl.classList.toggle("d-none", showWelcome);
  if (welcomeEl) welcomeEl.classList.toggle("d-flex", showWelcome);
  if (welcomeEl) welcomeEl.classList.toggle("d-none", !showWelcome);
  if (showWelcome) {
    renderWelcomeScreen();
    return;
  }
  const columnCount = getColumnCount();
  gridEl.style.setProperty("--dashboard-grid-columns", String(columnCount));
  const occupied = new Set(); // "col,row" for every cell any widget covers.
  layout.widgets.forEach((instance) => {
    for (let r = instance.row; r < instance.row + instance.rowSpan; r += 1) {
      for (let c = instance.col; c < instance.col + instance.colSpan; c += 1) {
        occupied.add(`${c},${r}`);
      }
    }
  });
  // A hard bound (same as columnCount), not a minimum — resize/drag/pack
  // already all clamp against it, so nothing should ever occupy a row past
  // this, but Math.max defends against genuinely stale/corrupt data (e.g. a
  // layout saved under a larger rowCount, edited elsewhere, then reloaded
  // here with a smaller one) rendering as silently clipped/invisible rather
  // than at least still showing up.
  let totalRows = getRowCount();
  layout.widgets.forEach((instance) => {
    totalRows = Math.max(totalRows, instance.row + instance.rowSpan);
  });
  disposeTooltips(gridEl);
  gridEl.innerHTML = "";
  layout.widgets.forEach((instance) => {
    const card = cardElements.get(instance.instanceId);
    if (!card) return;
    const anchor = el("div");
    anchor.dataset.gridZone = "";
    anchor.dataset.col = String(instance.col);
    anchor.dataset.row = String(instance.row);
    anchor.style.gridColumn = `${instance.col + 1} / span ${instance.colSpan}`;
    anchor.style.gridRow = `${instance.row + 1} / span ${instance.rowSpan}`;
    anchor.appendChild(card);
    gridEl.appendChild(anchor);
  });
  // Teardown-then-rebuild, every time — never incremental (leaking or
  // double-binding a Sortable instance on a zone that gets torn down and
  // recreated a moment later is worse than the modest cost of rebuilding a
  // handful of small instances each pass).
  gridZoneRegistry.forEach((sortable) => sortable?.destroy?.());
  gridZoneRegistry.clear();
  if (!editing) return;
  for (let r = 0; r < totalRows; r += 1) {
    for (let c = 0; c < columnCount; c += 1) {
      if (occupied.has(`${c},${r}`)) continue;
      const zone = el("div");
      zone.dataset.gridZone = "";
      zone.dataset.col = String(c);
      zone.dataset.row = String(r);
      zone.style.gridColumn = `${c + 1}`;
      zone.style.gridRow = `${r + 1}`;
      gridEl.appendChild(zone);
    }
  }
  // Deliberately NOT dnd.js's initSortableGroup/setupDropzones — every
  // `[data-grid-zone]` element (each widget's own anchor wrapper, plus every
  // empty-cell placeholder) becomes its own Sortable "list" directly, so
  // gridEl ITSELF never becomes a Sortable list too (setupDropzones treats
  // its own root as an extra zone, which — nested one level above the
  // per-widget anchors that already are zones — risks SortableJS attributing
  // a drag started on a card's own header handle to the wrong nesting level).
  gridEl.querySelectorAll("[data-grid-zone]").forEach((zone) => {
    const sortable = createSortable(zone, {
      group: { name: SORTABLE_GROUP, pull: true, put: true },
      // Only genuinely empty cells accept a drop — no swap/overlap
      // semantics. `evt.dragged` is excluded from the "already occupied"
      // check since SortableJS may have already provisionally inserted it
      // into `evt.to` for live drag preview by the time this fires.
      onMove(evt) {
        return !Array.from(evt.to.children).some((child) => child !== evt.dragged);
      },
      onEnd(evt) {
        const instance = findInstance(evt.item?.dataset.widgetInstanceId);
        const targetZone = evt.to;
        if (instance && targetZone) {
          instance.col = clampInt(targetZone.dataset.col, 0, getColumnCount() - 1, instance.col);
          instance.row = clampInt(targetZone.dataset.row, 0, getRowCount() - 1, instance.row);
          persistLayout();
        }
        // Deferred, not synchronous — this callback is firing from INSIDE
        // one of the very Sortable instances renderWidgetGrid is about to
        // destroy() and rebuild. Doing that immediately, before SortableJS
        // has finished its own post-drag cleanup for THIS instance (it isn't
        // done the moment onEnd fires — animation/DOM teardown still runs
        // after), is exactly what caused a real bug: the dropped widget kept
        // whatever 1x1 size its target zone had instead of its own
        // colSpan/rowSpan, because the rebuilt anchor's sizing got stomped
        // by SortableJS's own cleanup running after it. Letting the current
        // call stack finish first (setTimeout 0) avoids the collision.
        setTimeout(() => renderWidgetGrid(), 0);
      },
    });
    gridZoneRegistry.set(zone, sortable);
  });
}

function destroyAllWidgets() {
  mounted.forEach((api) => {
    try {
      api.destroy?.();
    } catch (error) {
      // A widget failing to tear down cleanly shouldn't block the rest of
      // the dashboard from re-rendering.
    }
  });
  mounted.clear();
  cardElements.clear();
  gridZoneRegistry.forEach((sortable) => sortable?.destroy?.());
  gridZoneRegistry.clear();
  if (gridEl) {
    // Widget-card headers can carry their own tooltip-bearing buttons now
    // (setHeaderAction/setRightAction) — dispose before wiping, same "don't
    // orphan a shown tooltip" reasoning as everywhere else this convention
    // is used (see populateAddToolbar's own comment).
    disposeTooltips(gridEl);
    gridEl.innerHTML = "";
  }
}

function renderWidgets() {
  destroyAllWidgets();
  layout.widgets.forEach((instance) => mountWidget(instance));
  // applyEditingState calls renderWidgetGrid itself (positioning depends on
  // whether the empty-cell drop zones need to exist, which depends on
  // editing) — see its own comment.
  applyEditingState();
  refreshWidgetInspector();
}

// Mirrors Loom's Property Inspector selection pattern
// ([data-system-row-selected="true"] + refreshSystemInspector) — one widget
// selected at a time, outlined via CSS. Selecting a widget no longer forces
// the right pane open (and deselecting no longer closes it) — the pane only
// ever opens/closes from its own toggle button (initPaneToggles) now;
// selection just keeps whatever's already open in sync via
// refreshWidgetInspector below, so opening the pane later always reflects
// whichever widget is currently selected.
function selectWidget(instanceId) {
  if (selectedWidgetInstanceId === instanceId) return;
  const previousCard = selectedWidgetInstanceId
    ? gridEl?.querySelector(`[data-widget-instance-id="${selectedWidgetInstanceId}"]`)
    : null;
  previousCard?.removeAttribute("data-widget-selected");
  selectedWidgetInstanceId = instanceId || "";
  const nextCard = selectedWidgetInstanceId
    ? gridEl?.querySelector(`[data-widget-instance-id="${selectedWidgetInstanceId}"]`)
    : null;
  nextCard?.setAttribute("data-widget-selected", "true");
  refreshWidgetInspector();
}

// Per-widget inspector bodies (Card's info+Refresh above; a map's layer
// toggles and a character's "switch character" picker in later phases) land
// here via an optional `renderInspector(container, {instance, api})` hook on
// the catalog entry — types without one (character/gamelog/combat today)
// get the same generic fallback body.
function refreshWidgetInspector() {
  if (!widgetInspectorEmpty || !widgetInspectorDetails) return;
  const instance = selectedWidgetInstanceId ? findInstance(selectedWidgetInstanceId) : null;
  const entry = instance ? findCatalogEntry(instance.widgetType) : null;
  widgetInspectorEmpty.hidden = Boolean(instance);
  // Same orphaned-tooltip failure mode fixed elsewhere on this page — the
  // Remove button (and any per-widget actions renderInspector adds) can
  // still be mid-tooltip when the details panel hides.
  if (!instance) disposeTooltips(widgetInspectorDetails);
  widgetInspectorDetails.classList.toggle("d-none", !instance);
  if (!instance || !entry) return;
  if (widgetInspectorType) widgetInspectorType.textContent = entry.label;
  if (widgetInspectorBody) {
    widgetInspectorBody.innerHTML = "";
    if (typeof entry.renderInspector === "function") {
      entry.renderInspector(widgetInspectorBody, {
        instance,
        api: mounted.get(instance.instanceId),
        dataManager,
        status,
        groupContext,
        shareParam,
      });
    } else {
      const note = document.createElement("p");
      note.className = "text-body-secondary small mb-0";
      note.textContent = "No extra settings for this widget yet — use Remove below to take it off your dashboard.";
      widgetInspectorBody.appendChild(note);
    }
  }
  // Re-arms the static Remove button's tooltip (disposed the last time this
  // panel was hidden) plus any tooltip-bearing buttons renderInspector just
  // built.
  refreshTooltips(widgetInspectorDetails);
}

function removeWidget(instanceId) {
  const index = layout.widgets.findIndex((instance) => instance.instanceId === instanceId);
  if (index === -1) return;
  layout.widgets.splice(index, 1);
  persistLayout();
  const api = mounted.get(instanceId);
  // The one destroy() call that means "gone for good" (as opposed to
  // destroyAllWidgets()'s routine teardown-before-remount) — Clock and
  // Browser's own destroy uses this to know it's safe to clear whatever
  // spotlight this instance may still hold (their content lives only in the
  // spotlight entry itself, not a Library record — see clocks.js/browser.js
  // — so a removed instance left spotlighted would otherwise orphan any
  // follower/second-screen view on frozen, never-clearable stale data).
  api?.destroy?.(true);
  mounted.delete(instanceId);
  cardElements.get(instanceId)?.remove();
  cardElements.delete(instanceId);
  renderWidgetGrid();
  populateAddToolbar();
  // Reflects a local removal (including the panel/log's own "toggle off")
  // instantly, without waiting for the next poll tick.
  refreshSpotlightPanel();
}

// `contentRef` lets a caller (acceptSpotlight, for Handout) hand a new widget
// instance a specific piece of content to show (e.g. which NPC) — omitted
// for widget types that don't need one.
function addWidget(widgetType, contentRef = null) {
  const entry = findCatalogEntry(widgetType);
  if (!entry) return null;
  if (entry.multiple !== true && allWidgetTypes().includes(widgetType)) return null;
  const instance = {
    instanceId: generateInstanceId(),
    widgetType,
    contentRef,
    colSpan: DEFAULT_COL_SPAN,
    rowSpan: DEFAULT_ROW_SPAN,
    zoom: DEFAULT_ZOOM,
  };
  layout.widgets.push(instance);
  // packLayout only fills in what's missing — every already-positioned
  // widget is untouched, this new one (no col/row yet) lands in the first
  // open spot.
  packLayout(layout.widgets, getColumnCount(), getRowCount());
  persistLayout();
  mountWidget(instance);
  renderWidgetGrid();
  populateAddToolbar();
  // Reflects a local addition (including the panel/log's own "toggle on")
  // instantly, without waiting for the next poll tick.
  refreshSpotlightPanel();
  return instance;
}

// Which macro action types get an auto-added, ongoing control surface on
// THIS dashboard when none already exists — not every type: Character
// shows whichever character is PINNED (a GM-wide preference a macro
// shouldn't silently override to whatever character it happened to touch),
// and Handout/Map/Game Log/Browser/Dice Roller are all "fire and forget"
// outcomes the group-log/spotlight broadcast itself already delivers in
// full — a widget on the GM's OWN dashboard was never needed for any of
// those to have worked. WLED/Soundboard/Combat are the three where a macro
// changes something genuinely ONGOING that benefits from staying visible
// and adjustable afterward (lights, currently-playing music, a running
// encounter) — matching the user's own "Haunted Forest" example.
const MACRO_ACTION_WIDGET_TYPES = { wled: "wled", soundboard: "soundboard", combat: "combat" };

// Clock/Calendar have no "ensure/add" story at all — unlike WLED/Soundboard/
// Combat (one meaningful instance, or a clearly-resolvable target), a macro
// targeting "whichever clock is shown to the table" can't sensibly conjure
// one into existence (which of possibly several would it even mean?). This
// only ever finds an already-mounted, already-visible instance of that type
// — see clocks.js/calendar.js's own isVisible() — returning null (a clear
// "nothing shown right now" error from macro-runner.js's own handler) when
// none qualifies, rather than guessing.
function findActiveWidgetInstance(widgetType) {
  const candidates = layout.widgets.filter((widget) => widget.widgetType === widgetType);
  for (const widget of candidates) {
    const api = mounted.get(widget.instanceId);
    if (api && typeof api.isVisible === "function" && api.isVisible()) return api;
  }
  return null;
}

// Passed into runMacro (macro-runner.js) as `ensureWidget`, called once per
// action before that action's own handler runs. Only ever wired up here —
// the Dashboard's own Macro board widget — never for a Journal-embedded
// macro trigger (journal-macro.js), since there's no widget grid to add to
// on a Repository page at all.
//
// WLED/Combat both externalize their real state (the physical device, the
// saved encounter record) — once a widget exists and is pointed at the
// right target, it just shows the correct thing on its own next
// fetch/mount, no extra plumbing needed (WLED's own contentRef is set to
// the resolved device below; Combat Tracker already defaults to whichever
// encounter is currently active/spotlighted with no contentRef needed, the
// same resolution startEncounter's own navigation already relies on).
// Soundboard is the one exception — playback lives in an ephemeral
// in-browser Audio object a freshly-mounted widget has nothing to
// "reconnect" to on its own — see soundboard.js's own exposed
// runMacroAction (returned from initSoundboardWidget, called by
// runSoundboardMacroAction) for how macro playback gets routed through
// whichever Soundboard widget instance actually ends up existing instead.
function ensureWidgetForMacroAction(action) {
  if (action?.type === "clock" || action?.type === "calendar") {
    return findActiveWidgetInstance(action.type);
  }
  const catalogId = MACRO_ACTION_WIDGET_TYPES[action?.type];
  if (!catalogId) return null;
  if (catalogId === "wled") {
    // Multiple WLED cards can exist (one per lighting zone) — reusing
    // whichever one happens to be first in layout.widgets regardless of
    // which device IT's pointed at would route the command through a card
    // showing the WRONG device's state (confirmed: this is exactly why the
    // "Haunted Forest" macro turned the lights on for real but the on-screen
    // card kept reading "Off" — the command itself went straight to the
    // device either way, but no card that actually shows that device ever
    // got a chance to refresh). Matches by the resolved device's own ip
    // against each existing card's persisted contentRef.selectedIp first.
    const device = resolveWledDeviceByAlias(wledDevices, action?.target);
    const matching = device
      ? layout.widgets.find((widget) => widget.widgetType === "wled" && widget.contentRef?.selectedIp === device.ip)
      : null;
    if (matching) return mounted.get(matching.instanceId) || null;
    const instance = addWidget(catalogId, device ? { selectedIp: device.ip } : null);
    return instance ? mounted.get(instance.instanceId) || null : null;
  }
  // Prefers a candidate whose mounted api actually exposes runMacroAction
  // over just "whichever matches this widgetType first" — a Soundboard (or
  // Combat) card can be mounted as a read-only FOLLOWER instead of the real
  // authoring one (contentRef.followKind — created by acceptSpotlight when
  // this account accepted someone else's spotlight, or the second-screen
  // mirror's own forcePlayerView self-follow), which has no runMacroAction
  // at all despite sharing the same widgetType. Silently grabbing that one
  // would send a macro's soundboard action down the standalone fallback
  // path (soundboard.js's own runSoundboardMacroAction) instead — audio
  // would still start (the fallback plays it too), but THIS card, being
  // read-only, would never reflect it either way. Falls back to the first
  // match if nothing qualifies (Combat, whose handler doesn't care about
  // widgetInstance at all) rather than null, so behavior for non-follower
  // cases is unchanged.
  const candidates = layout.widgets.filter((widget) => widget.widgetType === catalogId);
  const capable = candidates.find((widget) => typeof mounted.get(widget.instanceId)?.runMacroAction === "function");
  const existing = capable || candidates[0];
  if (existing) return mounted.get(existing.instanceId) || null;
  const instance = addWidget(catalogId, null);
  return instance ? mounted.get(instance.instanceId) || null : null;
}

// One icon button per available widget type — "available" meaning either the
// type allows multiple instances, or this is the first one. A type with no
// more available slots just disappears from the toolbar rather than
// rendering disabled, since there's nothing useful left to say about it.
function populateAddToolbar() {
  if (!addToolbar) return;
  // These buttons carry live Bootstrap Tooltip instances — wiping them via
  // innerHTML without disposing first orphans any currently-shown tooltip
  // popup on <body> forever (see tooltips.js's own comment on this exact
  // failure mode), which is what made tooltips here "stick" after adding or
  // removing a widget rebuilt this toolbar mid-hover.
  disposeTooltips(addToolbar);
  addToolbar.innerHTML = "";
  const present = allWidgetTypes();
  const available = WIDGET_CATALOG.filter(
    (entry) =>
      entry.addableFromToolbar !== false &&
      (entry.multiple === true || !present.includes(entry.id)) &&
      (!entry.canAdd || entry.canAdd())
  );
  available.forEach((entry) => {
    const button = document.createElement("button");
    button.type = "button";
    // Fixed dark background (not outline-secondary's transparent one) so
    // these stay visible no matter what background color the user picks for
    // the canvas behind them — same reasoning as the static color-picker/
    // reset buttons and the Edit layout toggle beside them.
    button.className = "btn btn-dark p-2";
    button.dataset.bsToggle = "tooltip";
    button.dataset.bsPlacement = "top";
    button.dataset.bsTitle = `Add ${entry.label}`;
    const icon = document.createElement("span");
    icon.className = "iconify fs-5";
    icon.dataset.icon = entry.icon;
    icon.setAttribute("aria-hidden", "true");
    const srLabel = document.createElement("span");
    srLabel.className = "visually-hidden";
    srLabel.textContent = `Add ${entry.label}`;
    button.append(icon, srLabel);
    button.addEventListener("click", async () => {
      if (typeof entry.pickContentRef === "function") {
        const contentRef = await entry.pickContentRef({ dataManager, status, groupContext, shareParam });
        if (!contentRef) return; // user cancelled, or had nothing to pick
        addWidget(entry.id, contentRef);
        return;
      }
      addWidget(entry.id);
    });
    addToolbar.appendChild(button);
  });
  // Freshly-created buttons have no live Bootstrap Tooltip instance yet —
  // same "dynamic DOM needs a rescan" reasoning as everywhere else this
  // convention is used (see Loom's Property Inspector).
  refreshTooltips(addToolbar);
}

function applyEditingState() {
  // Rebuilds the grid's own anchor/zone structure for the new editing
  // state (empty-cell drop zones + their Sortable wiring only exist while
  // editing — see renderWidgetGrid's own comment) — every widget card is
  // still findable via gridEl.querySelectorAll below afterward, just
  // relocated, not recreated.
  renderWidgetGrid();
  const headers = gridEl ? Array.from(gridEl.querySelectorAll("[data-widget-header]")) : [];
  headers.forEach((header) => {
    if (editing) {
      header.setAttribute("data-sortable-handle", "");
    } else {
      header.removeAttribute("data-sortable-handle");
    }
  });
  if (gridEl) {
    // A Remove button paired with a setRightAction button (Game Log's Clear
    // log, Map/Combat Tracker/Handout's visibility toggle) collapses out of
    // the layout entirely (d-none) instead of just going invisible, so that
    // action can shift into its place — see mountWidget's own setRightAction.
    gridEl
      .querySelectorAll("[data-widget-remove-collapsible]")
      .forEach((button) => button.classList.toggle("d-none", !editing));
    gridEl
      .querySelectorAll("[data-widget-remove]:not([data-widget-remove-collapsible])")
      .forEach((button) => button.classList.toggle("invisible", !editing));
    // Map's zoom control panel overlays the map itself (not the header), so
    // this is the opposite sense from Remove/setRightAction above — shown
    // only while NOT editing, hidden while editing rather than the reverse.
    gridEl.querySelectorAll("[data-map-zoom-panel]").forEach((panel) => panel.classList.toggle("d-none", editing));
    // Board widget macro-button cards (board.js's own renderMacroButtonCard)
    // — the click BEHAVIOR already switches live via ctx.isEditing()
    // (buildCtx), this just keeps the visible hint in sync so it doesn't
    // read stale after a toggle with no other reason for the widget itself
    // to re-render.
    gridEl.querySelectorAll("[data-macro-run-button]").forEach((button) => {
      button.title = editing ? "Edit in Loom" : "Run macro";
    });
    // The drag-to-resize handle (mountWidget) — editing-only. Plain inline
    // style.display, not the .d-none/.d-flex classes used elsewhere here —
    // see that element's own comment (createWidgetCard) on why.
    gridEl.querySelectorAll("[data-widget-resize-handle]").forEach((handle) => {
      handle.style.display = editing ? "block" : "none";
    });
    // The header zoom controls (mountWidget) — the OPPOSITE sense from the
    // resize handle: view-mode-only, hidden while editing (they're literally
    // view controls, adjusting how YOU see the widget, not the layout).
    gridEl.querySelectorAll("[data-widget-zoom-controls]").forEach((group) => {
      if (editing) {
        disposeTooltips(group);
        group.style.display = "none";
      } else {
        group.style.display = "inline-flex";
        refreshTooltips(group);
      }
    });
  }
  if (layoutTools) {
    // Same orphaned-tooltip failure mode as populateAddToolbar — hiding this
    // toolbar via d-none (not a size/visibility change Bootstrap's own
    // mouseleave handling reliably catches) can leave a shown tooltip
    // floating with no trigger left to dismiss it. Dispose right before
    // hiding, re-arm right after showing.
    if (editing) {
      layoutTools.classList.remove("d-none");
      // Sync from `layout` every time this becomes visible, not just once —
      // it can change out from under these inputs (onPinCharacter swapping
      // campaigns loads a different layout) while they were hidden.
      if (gridColumnsInput) gridColumnsInput.value = String(getColumnCount());
      if (gridRowsInput) gridRowsInput.value = String(getRowCount());
      refreshTooltips(layoutTools);
    } else {
      disposeTooltips(layoutTools);
      layoutTools.classList.add("d-none");
    }
  }
  if (titleDisplay) titleDisplay.classList.toggle("d-none", editing);
  if (titleInput) titleInput.classList.toggle("d-none", !editing);
  if (editToggle) editToggle.textContent = editing ? "Done editing" : "Edit layout";
}

async function onPinCharacter(characterId) {
  layout.pinnedCharacterId = characterId;
  persistLayout();
  // Pinning a character no longer touches groupContext (and so can't change
  // the dashboard's own campaign-name header title, or which group's log the
  // spotlight watcher follows) — see group-context.js's own
  // resolveGroupContext comment: the header's Campaign dropdown is the sole
  // source of truth for which campaign is active, independent of which
  // character happens to be pinned here. Still re-renders, since the
  // Character Sheet widget itself reads layout.pinnedCharacterId directly
  // and needs to pick up the new one.
  renderWidgets();
}

editToggle?.addEventListener("click", () => {
  const enteringEdit = !editing;
  editing = !editing;
  applyEditingState();
  // The panel's own per-icon "clear this" affordance only shows in edit
  // mode (see refreshSpotlightPanel/spotlight-panel.js) — re-render so
  // toggling edit mode shows/hides it immediately, not just on the next
  // poll tick.
  refreshSpotlightPanel();
  // Seed the input with the actual current (default) text so it reads as
  // real, easy-to-tweak content instead of starting blank behind a grey
  // placeholder — clearing it back to empty on blur/Enter still reverts to
  // the placeholder-shown default (applyHeaderTitle's normal binding).
  if (enteringEdit && titleInput && !headerTitleOverride) {
    titleInput.value = computeDefaultHeaderTitle();
  }
});

gridEl?.addEventListener("click", (event) => {
  // A click that landed on the canvas itself (not inside any widget card) —
  // e.g. empty grid space — deselects, same as clicking a Remove/Cancel
  // action would; a widget click below re-selects normally.
  const card = event.target.closest("[data-widget-instance-id]");
  selectWidget(card ? card.dataset.widgetInstanceId : "");
});

// A real on/off toggle now (not "open, or refocus if already open") — blue
// (btn-primary) while the mirror window is open, same "on" convention as a
// widget's own show-to-table button (mountWidget's setRightAction), and a
// second click closes that window outright rather than just focusing it.
// screenWindowRef is the actual WindowProxy window.open() hands back, which
// is also what lets this close it later — a *name* alone (the old
// "undercroft-screen" target) only lets you reopen/refocus, not close.
let screenWindowRef = null;
let screenWindowWatchTimer = 0;

function setScreenButtonActive(active) {
  if (!screenViewButton) return;
  screenViewButton.classList.toggle("btn-primary", active);
  screenViewButton.classList.toggle("btn-dark", !active);
}

function stopWatchingScreenWindow() {
  if (screenWindowWatchTimer) {
    window.clearInterval(screenWindowWatchTimer);
    screenWindowWatchTimer = 0;
  }
}

// There's no reliable cross-browser event for "a window I opened just got
// closed" (by its own OS close button, not through this toggle) — polling
// its own `.closed` flag is the standard workaround, so the button still
// reverts to inactive if the GM closes the mirror window directly instead
// of clicking this toggle again.
function watchScreenWindow() {
  stopWatchingScreenWindow();
  screenWindowWatchTimer = window.setInterval(() => {
    if (!screenWindowRef || screenWindowRef.closed) {
      screenWindowRef = null;
      setScreenButtonActive(false);
      stopWatchingScreenWindow();
    }
  }, 1000);
}

screenViewButton?.addEventListener("click", () => {
  if (screenWindowRef && !screenWindowRef.closed) {
    screenWindowRef.close();
    screenWindowRef = null;
    setScreenButtonActive(false);
    stopWatchingScreenWindow();
    return;
  }
  const search = new URLSearchParams();
  search.set("screen", "1");
  if (shareParam) search.set("share", shareParam);
  const url = new URL(window.location.href);
  url.search = `?${search.toString()}`;
  screenWindowRef = window.open(url, "undercroft-screen", "popup=yes,location=no,width=1280,height=800");
  // null when the browser's popup blocker stepped in — nothing opened, so
  // the button should stay showing "off."
  if (screenWindowRef) {
    setScreenButtonActive(true);
    watchScreenWindow();
  }
});

widgetInspectorRemove?.addEventListener("click", () => {
  if (!selectedWidgetInstanceId) return;
  const instanceId = selectedWidgetInstanceId;
  selectWidget("");
  removeWidget(instanceId);
});

colorInput?.addEventListener("input", () => {
  applyBackground(colorInput.value);
  persistBackground(colorInput.value);
});

colorReset?.addEventListener("click", () => {
  applyBackground("");
  persistBackground("");
});

gridColumnsInput?.addEventListener("change", () => {
  layout.columnCount = clampInt(gridColumnsInput.value, GRID_COLUMN_COUNT_MIN, GRID_COLUMN_COUNT_MAX, layout.columnCount);
  // A shrunk grid can leave existing widgets extending past the new right
  // edge — clamp their own colSpan/col to fit rather than leaving them
  // hanging off the grid entirely.
  layout.widgets.forEach((instance) => {
    instance.colSpan = Math.min(instance.colSpan, layout.columnCount);
    instance.col = Math.min(instance.col, layout.columnCount - instance.colSpan);
  });
  gridColumnsInput.value = String(layout.columnCount);
  persistLayout();
  renderWidgetGrid();
});

gridRowsInput?.addEventListener("change", () => {
  layout.rowCount = clampInt(gridRowsInput.value, GRID_ROW_COUNT_MIN, GRID_ROW_COUNT_MAX, layout.rowCount);
  // Same reflow as columns above — a shrunk grid can leave existing widgets
  // extending past the new bottom edge.
  layout.widgets.forEach((instance) => {
    instance.rowSpan = Math.min(instance.rowSpan, layout.rowCount);
    instance.row = Math.min(instance.row, layout.rowCount - instance.rowSpan);
  });
  gridRowsInput.value = String(layout.rowCount);
  persistLayout();
  renderWidgetGrid();
});

titleInput?.addEventListener("blur", () => {
  persistHeaderTitle(titleInput.value.trim());
  applyHeaderTitle();
});
titleInput?.addEventListener("keydown", (event) => {
  if (event.key === "Enter") {
    event.preventDefault();
    titleInput.blur();
  }
});

async function boot() {
  const serverSettings = await loadServerSettings();
  layout = await loadLayout(serverSettings);
  if (screenMode) {
    // The second-screen mirror, alone, no dashboard chrome at all — none of
    // the rest of boot()'s own setup (background, header title, help
    // browser, the add-widget toolbar, the spotlight watcher) applies to a
    // window whose only job is to display whatever's currently shown to the
    // table. See renderScreenView's own comment for why this still needs
    // groupContext resolved first.
    groupContext = await resolveGroupContext(dataManager, { shareToken: shareParam });
    renderScreenView();
    return;
  }
  background = loadBackground(serverSettings);
  headerTitleOverride = loadHeaderTitle(serverSettings);
  pinnedHelpTopics = loadPinnedHelpTopics(serverSettings);
  wledDevices = loadWledDevices(serverSettings);
  applyBackground(background);
  void initHelpBrowser({
    root: document,
    topicsUrl: "common/data/help-topics.json",
    pane: leftPane ? { element: leftPane, toggle: leftPaneToggle } : null,
    getPinnedIds: () => pinnedHelpTopics,
    onTogglePin: togglePinnedHelpTopic,
  });
  if (encounterParam && !allWidgetTypes().includes("combat")) {
    layout.widgets.push({
      instanceId: generateInstanceId(),
      widgetType: "combat",
      contentRef: null,
      colSpan: DEFAULT_COL_SPAN,
      rowSpan: DEFAULT_ROW_SPAN,
      zoom: DEFAULT_ZOOM,
    });
    packLayout(layout.widgets, getColumnCount(), getRowCount());
    persistLayout();
  }
  groupContext = await resolveGroupContext(dataManager, { shareToken: shareParam });
  applyHeaderTitle();
  renderWidgets();
  populateAddToolbar();
  startSpotlightPanelWatcher();
  // Activates the static data-bs-toggle="tooltip" markup (color picker,
  // reset button) — populateAddToolbar already covers its own dynamically
  // built buttons on its own.
  refreshTooltips(document);
  // Picking a different campaign from the header's own Campaign dropdown
  // while the Dashboard is already open (not landing here fresh after
  // switching it elsewhere) needs to actually take effect live — the header
  // selector is now the sole source of truth for groupContext (see
  // group-context.js's own resolveGroupContext comment), not just a value
  // read once at boot. Mirrors Workbench's own identical listener
  // (workbench-character-view.js). Skipped entirely for shareToken sessions
  // (an anonymous/share viewer has no header dropdown to change) and the
  // screen-mirror mode (no chrome at all — see this function's own early
  // return above).
  if (!shareParam) {
    window.addEventListener("workbench:active-group-changed", async () => {
      groupContext = await resolveGroupContext(dataManager, { shareToken: shareParam });
      applyHeaderTitle();
      renderWidgets();
      populateAddToolbar();
      startSpotlightPanelWatcher();
    });
  }
}

// The welcome screen only makes sense pre-login — a full reload after
// successfully signing in FROM it (its own CTA, or the header's own
// button) is the simplest, safest way to pick up the real experience
// (computeDefaultWidgets, a real header title, group context, ...) through
// the same boot() sequence every fresh load already goes through, rather
// than trying to re-run pieces of it live. Checked via the welcome screen's
// OWN current visibility (not a snapshot) — a normal logout, or an auth
// change on an already-populated dashboard, needs no reaction here.
window.addEventListener("undercroft:auth-changed", () => {
  if (welcomeEl && !welcomeEl.classList.contains("d-none") && dataManager.isAuthenticated()) {
    window.location.reload();
  }
});

void boot();
