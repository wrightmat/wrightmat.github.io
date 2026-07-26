import { initAppShell, resolveToolContextPath } from "./common/js/lib/app-shell.js";
import { DataManager } from "./common/js/lib/data-manager.js";
import { resolveApiBase } from "./common/js/lib/api.js";
import { initAuthControls } from "./common/js/lib/auth-ui.js";
import { initHelpSystem } from "./common/js/lib/help.js";
import { initSortableGroup } from "./common/js/lib/dnd.js";
import { initToolGridWidget } from "./common/js/lib/widgets/tool-grid.js";
import { initCharacterSummaryWidget } from "./common/js/lib/widgets/character-summary.js";
import { initGameLogWidget } from "./common/js/lib/widgets/game-log.js";
import { initNowShowingWidget } from "./common/js/lib/widgets/now-showing.js";
import { initCombatTrackerWidget } from "./common/js/lib/widgets/combat-tracker.js";
import { resolveGroupContext } from "./common/js/lib/widgets/group-context.js";
import { el } from "./common/js/lib/dom.js";

const LOCAL_LAYOUT_KEY = "undercroft.dashboard.layout";
const SORTABLE_GROUP = "dashboard-widgets";
const COLUMN_COUNT = 3;

const { status } = initAppShell({ namespace: "dashboard" });
const dataManager = new DataManager({ baseUrl: resolveApiBase(), storagePrefix: "undercroft.workbench" });
initAuthControls({ root: document, status, dataManager });
// This page lives at the suite root, one level shallower than every other
// tool page initHelpSystem's default topicsUrl assumes — same "home is the
// one exception" theme as app-shell.js's resolveToolHref/resolveAccountHref.
initHelpSystem({ root: document, topicsUrl: "common/data/help-topics.json" });

const WIDGET_CATALOG = [
  { id: "tools", label: "Jump to a tool", init: (container) => initToolGridWidget(container) },
  {
    id: "character",
    label: "Character summary",
    init: (container, ctx) =>
      initCharacterSummaryWidget(container, {
        dataManager: ctx.dataManager,
        pinnedCharacterId: ctx.layout.pinnedCharacterId,
        onPin: ctx.onPinCharacter,
      }),
  },
  {
    id: "gamelog",
    label: "Game log",
    init: (container, ctx) =>
      initGameLogWidget(container, {
        dataManager: ctx.dataManager,
        status: ctx.status,
        groupId: ctx.groupContext?.groupId || "",
        shareToken: ctx.groupContext?.shareToken || "",
      }),
  },
  {
    id: "nowshowing",
    label: "Now showing",
    init: (container, ctx) =>
      initNowShowingWidget(container, {
        dataManager: ctx.dataManager,
        groupId: ctx.groupContext?.groupId || "",
        shareToken: ctx.groupContext?.shareToken || "",
      }),
  },
  {
    id: "combat",
    label: "Combat tracker",
    init: (container, ctx) =>
      initCombatTrackerWidget(container, {
        dataManager: ctx.dataManager,
        status: ctx.status,
        mode: ctx.dataManager.meetsTier("gm") ? "gm" : "player",
        groupId: ctx.groupContext?.groupId || "",
        shareToken: ctx.groupContext?.shareToken || ctx.shareParam || "",
        encounterId: ctx.encounterParam || "",
      }),
  },
];

function findCatalogEntry(id) {
  return WIDGET_CATALOG.find((entry) => entry.id === id);
}

function distributeRoundRobin(ids) {
  const columns = Array.from({ length: COLUMN_COUNT }, () => []);
  ids.forEach((id, index) => columns[index % COLUMN_COUNT].push(id));
  return columns;
}

// Accepts either the current `{columns: [[id,...], ...]}` shape or the
// original flat `{widgets: [id,...]}` shape a layout saved before columns
// existed would still have — distributing those round-robin rather than
// just dropping a user's existing customization on first load after this
// change.
function normalizeLayout(raw) {
  if (raw && Array.isArray(raw.columns) && raw.columns.length) {
    const columns = [];
    for (let i = 0; i < COLUMN_COUNT; i += 1) {
      columns.push(Array.isArray(raw.columns[i]) ? raw.columns[i].filter((id) => findCatalogEntry(id)) : []);
    }
    for (let i = COLUMN_COUNT; i < raw.columns.length; i += 1) {
      if (Array.isArray(raw.columns[i])) {
        columns[COLUMN_COUNT - 1].push(...raw.columns[i].filter((id) => findCatalogEntry(id)));
      }
    }
    return { columns, pinnedCharacterId: raw.pinnedCharacterId || "" };
  }
  if (raw && Array.isArray(raw.widgets)) {
    return { columns: distributeRoundRobin(raw.widgets.filter((id) => findCatalogEntry(id))), pinnedCharacterId: raw.pinnedCharacterId || "" };
  }
  return null;
}

function loadLocalLayout() {
  try {
    const raw = localStorage.getItem(LOCAL_LAYOUT_KEY);
    return raw ? JSON.parse(raw) : null;
  } catch (error) {
    return null;
  }
}

function saveLocalLayout(layout) {
  try {
    localStorage.setItem(LOCAL_LAYOUT_KEY, JSON.stringify(layout));
  } catch (error) {
    // Local storage may be unavailable (private browsing, quota) — the
    // server sync below (when signed in) still gives this a home.
  }
}

// Only affects the very first load, before anyone has customized anything.
async function computeDefaultWidgets() {
  if (!dataManager.isAuthenticated()) {
    return ["tools"];
  }
  if (dataManager.meetsTier("gm")) {
    return ["combat", "nowshowing", "tools"];
  }
  const context = await resolveGroupContext(dataManager, {});
  return context ? ["character", "gamelog", "nowshowing"] : ["tools"];
}

async function loadLayout() {
  if (dataManager.isAuthenticated()) {
    try {
      const settings = await dataManager.getUserSettings();
      const normalized = normalizeLayout(settings?.dashboardLayout);
      if (normalized) return normalized;
    } catch (error) {
      // Fall through to localStorage/defaults.
    }
  }
  const normalizedLocal = normalizeLayout(loadLocalLayout());
  if (normalizedLocal) {
    return normalizedLocal;
  }
  return { columns: distributeRoundRobin(await computeDefaultWidgets()), pinnedCharacterId: "" };
}

function persistLayout() {
  saveLocalLayout(layout);
  if (dataManager.isAuthenticated()) {
    dataManager.saveUserSettings({ dashboardLayout: layout }).catch((error) => {
      status?.show(error.message || "Unable to sync your layout.", { type: "error" });
    });
  }
}

const params = new URLSearchParams(window.location.search || "");
const encounterParam = params.get("encounter") || "";
const shareParam = params.get("share") || "";

let layout = null;
let groupContext = null;
let editing = false;
let sortableInstances = [];
const mounted = new Map(); // widget id -> { destroy() }

const columnsWrapper = document.querySelector("[data-dashboard-columns]");
const columnEls = Array.from({ length: COLUMN_COUNT }, (_, i) => document.querySelector(`[data-dashboard-column="${i}"]`));
const editToggle = document.querySelector("[data-dashboard-edit-toggle]");
const addPanel = document.querySelector("[data-dashboard-add-widget]");
const addSelect = document.querySelector("[data-dashboard-add-select]");
const addButton = document.querySelector("[data-dashboard-add-button]");

function allWidgetIds() {
  return layout.columns.flat();
}

function findWidgetColumnIndex(id) {
  return layout.columns.findIndex((column) => column.includes(id));
}

function createWidgetCard(id, label) {
  const card = el("div", "card shadow-theme dashboard-widget-card");
  card.dataset.widgetId = id;
  const body = el("div", "card-body d-flex flex-column gap-2");
  const header = el("div", "d-flex justify-content-between align-items-center");
  header.dataset.widgetHeader = "";
  header.appendChild(el("h3", "h6 mb-0", label));
  const removeButton = el("button", "btn btn-sm btn-outline-danger d-none");
  removeButton.type = "button";
  removeButton.dataset.widgetRemove = "";
  const removeIcon = el("span", "iconify");
  removeIcon.dataset.icon = "tabler:x";
  removeIcon.setAttribute("aria-hidden", "true");
  removeButton.appendChild(removeIcon);
  removeButton.addEventListener("click", () => removeWidget(id));
  header.appendChild(removeButton);
  const mount = el("div");
  body.append(header, mount);
  card.appendChild(body);
  return { card, header, mount, removeButton };
}

function buildCtx() {
  return {
    dataManager,
    status,
    layout,
    groupContext,
    encounterParam,
    shareParam,
    onPinCharacter,
  };
}

function mountWidget(id, columnIndex) {
  const entry = findCatalogEntry(id);
  const columnEl = columnEls[columnIndex];
  if (!entry || !columnEl) return;
  const { card, header, mount, removeButton } = createWidgetCard(id, entry.label);
  removeButton.classList.toggle("d-none", !editing);
  if (editing) header.setAttribute("data-sortable-handle", "");
  columnEl.appendChild(card);
  const api = entry.init(mount, buildCtx()) || { destroy() {} };
  mounted.set(id, api);
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
  columnEls.forEach((columnEl) => {
    if (columnEl) columnEl.innerHTML = "";
  });
}

function renderWidgets() {
  destroyAllWidgets();
  layout.columns.forEach((ids, columnIndex) => {
    ids.forEach((id) => mountWidget(id, columnIndex));
  });
  applyEditingState();
}

function removeWidget(id) {
  const columnIndex = findWidgetColumnIndex(id);
  if (columnIndex === -1) return;
  layout.columns[columnIndex] = layout.columns[columnIndex].filter((widgetId) => widgetId !== id);
  persistLayout();
  const api = mounted.get(id);
  api?.destroy?.();
  mounted.delete(id);
  const card = columnEls[columnIndex]?.querySelector(`[data-widget-id="${id}"]`);
  card?.remove();
  populateAddSelect();
}

function addWidget(id) {
  if (!id || allWidgetIds().includes(id)) return;
  let shortest = 0;
  layout.columns.forEach((column, index) => {
    if (column.length < layout.columns[shortest].length) shortest = index;
  });
  layout.columns[shortest].push(id);
  persistLayout();
  mountWidget(id, shortest);
  populateAddSelect();
}

function populateAddSelect() {
  if (!addSelect) return;
  addSelect.innerHTML = "";
  const present = allWidgetIds();
  const available = WIDGET_CATALOG.filter((entry) => !present.includes(entry.id));
  if (!available.length) {
    addSelect.appendChild(new Option("All widgets added", ""));
    addSelect.disabled = true;
    if (addButton) addButton.disabled = true;
    return;
  }
  addSelect.disabled = false;
  if (addButton) addButton.disabled = false;
  available.forEach((entry) => addSelect.appendChild(new Option(entry.label, entry.id)));
}

// initSortableGroup wires drag between/within all three column lists at
// once (see dnd.js) and dispatches a bubbling "sortable:changed" event on
// whichever list a drag started from — one listener on the shared wrapper
// catches every drag, and recomputes all three columns from their current
// DOM order (an item may have moved between columns, not just within one).
function recomputeColumnsFromDom() {
  layout.columns = columnEls.map((columnEl) =>
    columnEl ? Array.from(columnEl.querySelectorAll("[data-widget-id]")).map((card) => card.dataset.widgetId) : []
  );
  persistLayout();
}

function applyEditingState() {
  const allHeaders = columnEls.flatMap((columnEl) => (columnEl ? Array.from(columnEl.querySelectorAll("[data-widget-header]")) : []));
  allHeaders.forEach((header) => {
    if (editing) {
      header.setAttribute("data-sortable-handle", "");
    } else {
      header.removeAttribute("data-sortable-handle");
    }
  });
  columnEls.forEach((columnEl) => {
    columnEl?.querySelectorAll("[data-widget-remove]").forEach((button) => button.classList.toggle("d-none", !editing));
  });
  if (addPanel) addPanel.classList.toggle("d-none", !editing);
  if (editToggle) editToggle.textContent = editing ? "Done editing" : "Edit layout";
  sortableInstances.forEach((instance) => instance?.destroy?.());
  sortableInstances = [];
  if (editing && columnsWrapper) {
    sortableInstances = initSortableGroup(columnsWrapper, SORTABLE_GROUP);
  }
}

async function onPinCharacter(characterId) {
  layout.pinnedCharacterId = characterId;
  persistLayout();
  groupContext = await resolveGroupContext(dataManager, {
    pinnedCharacterId: layout.pinnedCharacterId,
    shareToken: shareParam,
  });
  // The pin changes which campaign these widgets should be looking at —
  // re-render everything rather than tracking which widgets specifically
  // depend on group context; the cost is negligible for a handful of cards.
  renderWidgets();
}

editToggle?.addEventListener("click", () => {
  editing = !editing;
  applyEditingState();
});

addButton?.addEventListener("click", () => {
  const id = addSelect?.value;
  if (id) addWidget(id);
});

columnsWrapper?.addEventListener("sortable:changed", recomputeColumnsFromDom);

async function boot() {
  layout = await loadLayout();
  if (encounterParam && !allWidgetIds().includes("combat")) {
    let shortest = 0;
    layout.columns.forEach((column, index) => {
      if (column.length < layout.columns[shortest].length) shortest = index;
    });
    layout.columns[shortest].push("combat");
    persistLayout();
  }
  groupContext = await resolveGroupContext(dataManager, {
    pinnedCharacterId: layout.pinnedCharacterId,
    shareToken: shareParam,
  });
  renderWidgets();
  populateAddSelect();
}

void boot();
