import { initAppShell, resolveToolHref, resolveToolContextPath } from "./js/lib/app-shell.js";
import { DataManager, ROLE_ORDER, WRITE_ROLE_REQUIREMENTS, roleRank } from "./js/lib/data-manager.js";
import { resolveApiBase } from "./js/lib/api.js";
import { initAuthControls } from "./js/lib/auth-ui.js";
import { initHelpSystem } from "./js/lib/help.js";
import { initHelpBrowser as initHelpBrowserModule } from "./js/lib/help-browser.js";
import { confirmDelete } from "./js/lib/ownership.js";
import { initShareModal } from "./js/lib/share-modal.js";
import { disableForm } from "./js/lib/dom.js";
import {
  DICE_THEMES,
  DICE_THEME_NAMES,
  getThemeColorSupport,
  getThemeDefaultColor,
  previewDiceTheme,
} from "./js/lib/widgets/dice-overlay.js";

const { status } = initAppShell({
  namespace: "account",
  leftPane: { size: "lg", initial: "expanded" },
});
const loomHref = resolveToolHref("loom", resolveToolContextPath());
const dataManager = new DataManager({ baseUrl: resolveApiBase(), storagePrefix: "undercroft.workbench" });
const auth = initAuthControls({ root: document, status, dataManager });
const shareModal = initShareModal({ dataManager, status });
initHelpSystem({ root: document });

const elements = {
  panel: document.querySelector("[data-admin-panel]"),
  gate: document.querySelector("[data-admin-gate]"),
  openLogin: document.querySelector("[data-admin-open-login]"),
  tabs: document.querySelector("[data-admin-tabs]"),
  tabButtons: Array.from(document.querySelectorAll("[data-admin-tab]")),
  tabPanels: Array.from(document.querySelectorAll("[data-admin-tab-panel]")),
  ownedTable: document.querySelector("[data-admin-owned-table]"),
  ownedBody: document.querySelector("[data-admin-owned-rows]"),
  ownedEmpty: document.querySelector("[data-admin-owned-empty]"),
  ownedSummary: document.querySelector("[data-admin-owned-summary]"),
  ownedUserSelect: document.querySelector("[data-admin-owned-user]"),
  ownedFilter: document.querySelector("[data-admin-owned-filter]"),
  ownedTypeSelect: document.querySelector("[data-admin-owned-type]"),
  ownedSortHeaders: Array.from(document.querySelectorAll("[data-admin-owned-sort]")),
  quickReference: document.querySelector("[data-quick-reference]"),
  // Help & Documentation lives in the LEFT pane here (swapped with the
  // campaign quick-reference, which moved to the right) — named for what's
  // actually there now, not which physical side it happens to be.
  leftPane: document.querySelector('[data-pane="left"]'),
  leftPaneToggle: document.querySelector('[data-pane-toggle="left"]'),
  emailForm: document.querySelector("[data-admin-email-form]"),
  emailError: document.querySelector("[data-admin-email-error]"),
  emailInput: document.getElementById("admin-settings-email"),
  passwordForm: document.querySelector("[data-admin-password-form]"),
  passwordError: document.querySelector("[data-admin-password-error]"),
  passwordConfirm: document.getElementById("admin-settings-password-confirm"),
  favoriteColorControl: document.querySelector("[data-favorite-color-control]"),
  favoriteColorInput: document.getElementById("admin-settings-favorite-color"),
  favoriteColorClear: document.querySelector("[data-favorite-color-clear]"),
  diceThemeSelect: document.querySelector("[data-dice-theme-select]"),
  diceColorControl: document.querySelector("[data-dice-color-control]"),
  diceColorInput: document.getElementById("admin-settings-dice-color"),
  diceColorReset: document.querySelector("[data-dice-color-reset]"),
  dicePreview: document.querySelector("[data-dice-preview]"),
};

const TIER_OPTIONS = [
  { value: "free", label: "Free" },
  { value: "player", label: "Player" },
  { value: "gm", label: "GM" },
  { value: "creator", label: "Creator" },
  { value: "admin", label: "Admin" },
];

// Keyed by Library `kind` id (singular — "character", "template", "system",
// "species", ...), matching list_owned_content()'s item.bucket directly now
// that every kind shares the same library_items table. A kind not listed
// here just falls back to its raw id/tier list elsewhere below — every kind
// still shows up in Owned Content, just without a prettier label.
const OWNED_TYPE_LABELS = {
  character: "Character",
  template: "Template",
  system: "System",
};

// The inverse of server/kinds.py's own _LEGACY_BUCKET_ALIASES — that file's
// comment explains why: character/template/system predate the unified kind
// registry and still use plural DataManager bucket names
// ("characters"/"templates"/"systems") everywhere else in the client, while
// this page's own item.bucket (from list_owned_content()) uses the singular
// kind id like every other kind. WRITE_ROLE_REQUIREMENTS is keyed by the
// plural form, so this translates before looking it up.
const OWNER_BUCKET_ALIASES = { character: "characters", template: "templates", system: "systems" };

const TAB_SETTINGS = "settings";
const TAB_OWNED = "owned";
const AVAILABLE_TABS = [TAB_SETTINGS, TAB_OWNED];

const dateFormatter = typeof Intl !== "undefined" && typeof Intl.DateTimeFormat === "function"
  ? new Intl.DateTimeFormat(undefined, { dateStyle: "medium", timeStyle: "short" })
  : null;

const viewState = {
  activeTab: TAB_SETTINGS,
  users: [],
  owned: {
    owner: null,
    items: [],
    selectedUsername: "",
    selectedType: "",
    loading: false,
    stale: true,
    sort: { key: "last_accessed_at", direction: "desc" },
  },
};

function isAdminSession() {
  const session = dataManager.session;
  return Boolean(session && session.user && session.user.tier === "admin");
}

function currentUser() {
  return dataManager.session?.user || null;
}

// Derived from data-manager.js's own WRITE_ROLE_REQUIREMENTS/ROLE_ORDER
// (imported) rather than a second hand-maintained tier list — this used to
// be an independent OWNER_ROLE_REQUIREMENTS array that had already drifted
// out of sync with it (excluding "free" from character ownership, while
// WRITE_ROLE_REQUIREMENTS and character.json's own writeTier both already
// agreed free tier can write/own a character).
function tierMeetsOwnerRequirement(tier, bucket) {
  const requirement = WRITE_ROLE_REQUIREMENTS[OWNER_BUCKET_ALIASES[bucket] || bucket];
  if (!requirement) {
    return true;
  }
  const minRank = roleRank(requirement);
  if (minRank < 0) {
    return true;
  }
  return roleRank(tier) >= minRank;
}

function resolveTabFromHash() {
  const hash = window.location.hash ? window.location.hash.slice(1).toLowerCase() : "";
  return AVAILABLE_TABS.includes(hash) ? hash : TAB_SETTINGS;
}

viewState.activeTab = resolveTabFromHash();

function showPanel() {
  if (elements.panel) {
    elements.panel.hidden = false;
  }
  if (elements.gate) {
    elements.gate.hidden = true;
  }
}

function showGate() {
  if (elements.panel) {
    elements.panel.hidden = true;
  }
  if (elements.gate) {
    elements.gate.hidden = false;
  }
}

function updateLocationHash(tab) {
  if (!window.history || typeof window.history.replaceState !== "function") {
    return;
  }
  const base = `${window.location.pathname}${window.location.search || ""}`;
  if (tab === TAB_SETTINGS) {
    window.history.replaceState(null, "", base);
  } else {
    window.history.replaceState(null, "", `${base}#${tab}`);
  }
}

function setActiveTab(name, { updateHash = true, force = false } = {}) {
  const target = name;
  if (!force && viewState.activeTab === target) {
    if (updateHash) {
      updateLocationHash(target);
    }
    return;
  }
  viewState.activeTab = target;
  if (elements.tabButtons) {
    elements.tabButtons.forEach((button) => {
      if (!button) return;
      const tabName = button.getAttribute("data-admin-tab");
      const isActive = tabName === target;
      button.classList.toggle("active", isActive);
      button.setAttribute("aria-selected", isActive ? "true" : "false");
    });
  }
  if (elements.tabPanels) {
    elements.tabPanels.forEach((panel) => {
      if (!panel) return;
      const tabName = panel.getAttribute("data-admin-tab-panel");
      const isActive = tabName === target;
      panel.classList.toggle("show", isActive);
      panel.classList.toggle("active", isActive);
      panel.setAttribute("aria-hidden", isActive ? "false" : "true");
      panel.hidden = !isActive;
    });
  }
  if (updateHash) {
    updateLocationHash(target);
  }
  if (target === TAB_OWNED) {
    if (isAdminSession() && !viewState.users.length) {
      void loadUsers({ force: true });
    }
    populateOwnedUserFilter();
    loadOwnedContent();
  }
}

function populateSettings({ force = false } = {}) {
  const user = currentUser();
  if (elements.emailInput && (force || document.activeElement !== elements.emailInput)) {
    elements.emailInput.value = user?.email || "";
  }
  if (elements.emailForm) {
    const passwordField = elements.emailForm.querySelector("[name='password']");
    if (passwordField && (force || !document.activeElement || document.activeElement === passwordField)) {
      passwordField.value = "";
    }
  }
  if (elements.favoriteColorInput && (force || document.activeElement !== elements.favoriteColorInput)) {
    void loadFavoriteColor();
  }
  if (elements.diceThemeSelect && (force || document.activeElement !== elements.diceColorInput)) {
    void loadDiceSettings();
  }
}

// Static — every option comes from dice-overlay.js's own curated
// DICE_THEMES, not from anything user- or session-specific, so this only
// ever needs to run once.
function populateDiceThemeOptions() {
  const select = elements.diceThemeSelect;
  if (!select) {
    return;
  }
  const fragment = document.createDocumentFragment();
  DICE_THEMES.forEach(({ name, label }) => {
    const option = document.createElement("option");
    option.value = name;
    option.textContent = label;
    fragment.appendChild(option);
  });
  select.replaceChildren(fragment);
}

// Hides the whole color control for a theme dice-overlay.js's own
// getThemeColorSupport says can't be tinted at all (see that function's own
// header for the "color" vs "standard" material split) — no point showing
// a control that would visibly do nothing. Unlike Favorite color below,
// there's no "unset" state here: a colorable theme's swatch always shows a
// real, already-meaningful value (the saved one, or the theme's own
// getThemeDefaultColor) that the user can see and change, never a blank
// left for something else to invent silently later — see dice-overlay.js's
// own DICE_THEMES header for why that used to be a real crash.
function refreshDiceColorVisibility(theme) {
  elements.diceColorControl?.classList.toggle("d-none", !getThemeColorSupport(theme));
}

async function loadDiceSettings() {
  if (!elements.diceThemeSelect || !dataManager.isAuthenticated()) {
    return;
  }
  let theme = "default";
  let themeColor = "";
  try {
    const settings = await dataManager.getUserSettings();
    if (DICE_THEME_NAMES.includes(settings?.diceSettings?.theme)) {
      theme = settings.diceSettings.theme;
    }
    if (typeof settings?.diceSettings?.themeColor === "string") {
      themeColor = settings.diceSettings.themeColor;
    }
  } catch (error) {
    // Falls through to the "default theme, its own default color" starting
    // point below either way.
  }
  elements.diceThemeSelect.value = theme;
  refreshDiceColorVisibility(theme);
  if (elements.diceColorInput) {
    elements.diceColorInput.value = themeColor || getThemeDefaultColor(theme);
  }
}

async function saveDiceSettings() {
  if (!dataManager.isAuthenticated()) {
    return;
  }
  const theme = elements.diceThemeSelect?.value || "default";
  const themeColor = getThemeColorSupport(theme) ? elements.diceColorInput?.value || "" : "";
  try {
    await dataManager.saveUserSettings({ diceSettings: { theme, themeColor } });
    status?.show("Dice appearance saved", { type: "success", timeout: 1500 });
  } catch (error) {
    status?.show(error.message || "Unable to save your dice appearance.", { type: "error" });
  }
}

// No default — deliberately NOT auto-saved or shown as "already chosen"
// the way an earlier version of this did. .template-color-control--unset
// (common/css/shell.css, the same checkerboard-X treatment Press/Workbench's
// own color-picker.js uses for "nothing set") is the ONLY thing that stands
// in for a value here; the user has to actually pick a color for one to
// exist at all. Any tool can read the real value back the same way
// (dataManager.getUserSettings() → .favoriteColor) — no dedicated endpoint,
// just another key in the same general-purpose settings blob
// dashboardLayout/dashboardBackground/etc. already share (server/auth.py's
// users.settings column).
function setFavoriteColorUnset(isUnset) {
  elements.favoriteColorControl?.classList.toggle("template-color-control--unset", isUnset);
  if (elements.favoriteColorClear) {
    elements.favoriteColorClear.disabled = isUnset;
  }
}

async function loadFavoriteColor() {
  if (!elements.favoriteColorInput || !dataManager.isAuthenticated()) {
    return;
  }
  try {
    const settings = await dataManager.getUserSettings();
    if (typeof settings?.favoriteColor === "string" && settings.favoriteColor) {
      elements.favoriteColorInput.value = settings.favoriteColor;
      setFavoriteColorUnset(false);
      return;
    }
  } catch (error) {
    // Falls through to the unset state below either way.
  }
  setFavoriteColorUnset(true);
}

function formatTier(tier) {
  if (!tier) return "Free";
  const option = TIER_OPTIONS.find((item) => item.value === tier);
  return option ? option.label : tier;
}

function formatTimestamp(value, fallback = "Unknown") {
  if (!value) {
    return fallback;
  }
  let source = value;
  if (typeof source === "string" && source.includes(" ") && !source.includes("T")) {
    source = source.replace(" ", "T");
  }
  const date = new Date(source);
  if (Number.isNaN(date.getTime())) {
    return value || fallback;
  }
  return dateFormatter ? dateFormatter.format(date) : date.toLocaleString();
}

// Doesn't render a users table (that lives in Loom now) — this just keeps
// viewState.users populated so the Owned Content owner picker (buildOwnerOptions)
// has the full user list to offer as ownership-transfer targets.
async function loadUsers({ force = false } = {}) {
  if (!isAdminSession()) {
    return;
  }
  if (!force && viewState.users.length) {
    return;
  }
  try {
    const payload = await dataManager.listUsers();
    const users = Array.isArray(payload?.users) ? payload.users : [];
    viewState.users = users;
    populateOwnedUserFilter();
    if (viewState.activeTab === TAB_OWNED) {
      renderOwnedItems(viewState.owned.items, viewState.owned.owner);
    }
  } catch (error) {
    if (status) {
      status.show(error.message || "Unable to load users", { type: "danger" });
    }
  }
}

function populateOwnedUserFilter() {
  if (!elements.ownedFilter) {
    return;
  }
  const admin = isAdminSession();
  elements.ownedFilter.classList.toggle("d-none", !admin);
  if (!admin) {
    if (elements.ownedUserSelect) {
      elements.ownedUserSelect.innerHTML = "";
    }
    viewState.owned.selectedUsername = "";
    return;
  }
  const select = elements.ownedUserSelect;
  if (!select) {
    return;
  }
  const selected = viewState.owned.selectedUsername === "__all__" ? "__all__" : "";
  const fragment = document.createDocumentFragment();
  const meOption = document.createElement("option");
  meOption.value = "";
  meOption.textContent = "Me";
  fragment.appendChild(meOption);
  const everyoneOption = document.createElement("option");
  everyoneOption.value = "__all__";
  everyoneOption.textContent = "Everyone";
  fragment.appendChild(everyoneOption);
  select.replaceChildren(fragment);
  select.value = selected;
  viewState.owned.selectedUsername = selected;
}

// Options come from whichever kinds are actually present in the current
// owned-content result set (not a hardcoded kind list) — the suite's set of
// Library kinds is open-ended and keeps growing, and there's no point
// offering a filter option that would just show an empty table.
function populateOwnedTypeFilter() {
  const select = elements.ownedTypeSelect;
  if (!select) {
    return;
  }
  const previous = viewState.owned.selectedType;
  const buckets = Array.from(new Set(viewState.owned.items.map((item) => item.bucket).filter(Boolean))).sort((a, b) =>
    (OWNED_TYPE_LABELS[a] || a).localeCompare(OWNED_TYPE_LABELS[b] || b)
  );
  const fragment = document.createDocumentFragment();
  const allOption = document.createElement("option");
  allOption.value = "";
  allOption.textContent = "All types";
  fragment.appendChild(allOption);
  buckets.forEach((bucket) => {
    const option = document.createElement("option");
    option.value = bucket;
    option.textContent = OWNED_TYPE_LABELS[bucket] || bucket;
    fragment.appendChild(option);
  });
  select.replaceChildren(fragment);
  const stillValid = previous && buckets.includes(previous);
  select.value = stillValid ? previous : "";
  viewState.owned.selectedType = stillValid ? previous : "";
}

function setOwnedLoading(message = "Loading content…") {
  if (!elements.ownedBody) {
    return;
  }
  if (elements.ownedTable) {
    elements.ownedTable.hidden = false;
  }
  if (elements.ownedEmpty) {
    elements.ownedEmpty.hidden = true;
  }
  const row = document.createElement("tr");
  const cell = document.createElement("td");
  cell.colSpan = 6;
  cell.className = "text-center py-4 text-body-secondary";
  cell.textContent = message;
  row.appendChild(cell);
  elements.ownedBody.replaceChildren(row);
}

function showOwnedEmpty(message = "No saved content yet.") {
  if (elements.ownedTable) {
    elements.ownedTable.hidden = true;
  }
  if (elements.ownedEmpty) {
    elements.ownedEmpty.hidden = false;
    elements.ownedEmpty.textContent = message;
  }
  if (elements.ownedBody) {
    elements.ownedBody.innerHTML = "";
  }
}

function updateOwnedSummary(owner, itemCount = 0) {
  if (!elements.ownedSummary) {
    return;
  }
  if (!owner) {
    elements.ownedSummary.textContent = "";
    return;
  }
  const countLabel = itemCount === 1 ? "1 item" : `${itemCount} items`;
  const viewingEveryone = viewState.owned.selectedUsername === "__all__";
  if (viewingEveryone) {
    const subject = owner.display_name || owner.username || "everyone";
    elements.ownedSummary.textContent = `Viewing ${subject} — ${countLabel}.`;
    return;
  }
  const tierLabel = formatTier(owner.tier);
  const viewingSelf = !viewState.owned.selectedUsername || viewState.owned.selectedUsername === owner.username;
  const subject = viewingSelf ? "your account" : owner.username;
  elements.ownedSummary.textContent = `Viewing ${subject} (${tierLabel}) — ${countLabel}.`;
}

function describeOwnerOption(username, tier) {
  if (!username) {
    return "";
  }
  const base = `${username} (${formatTier(tier)})`;
  const current = currentUser();
  if (current && current.username === username) {
    return `${base} (You)`;
  }
  return base;
}

function buildOwnerOptions(bucket, currentOwner = { username: "", tier: "" }) {
  const options = [];
  const seen = new Set();
  const ownerUsername = currentOwner?.username || "";
  const ownerTier = currentOwner?.tier || "";
  if (ownerUsername) {
    options.push({ value: ownerUsername, label: describeOwnerOption(ownerUsername, ownerTier) });
    seen.add(ownerUsername);
  }
  if (!isAdminSession()) {
    return options;
  }
  const current = currentUser();
  if (current && !seen.has(current.username) && tierMeetsOwnerRequirement(current.tier, bucket)) {
    options.push({ value: current.username, label: describeOwnerOption(current.username, current.tier) });
    seen.add(current.username);
  }
  const eligibleUsers = viewState.users
    .filter((user) => user && user.username && tierMeetsOwnerRequirement(user.tier, bucket))
    .sort((a, b) => a.username.localeCompare(b.username, undefined, { sensitivity: "base" }));
  eligibleUsers.forEach((user) => {
    if (seen.has(user.username)) {
      return;
    }
    options.push({ value: user.username, label: describeOwnerOption(user.username, user.tier) });
    seen.add(user.username);
  });
  return options;
}

// `bucket` (from list_owned_content's `item.bucket`) is already the Library
// `kind` id directly now (e.g. "species", "character", "template" — always
function ownedSortValue(item, key) {
  switch (key) {
    case "name":
      return (item.label || item.id || "").toLowerCase();
    case "type":
      return (OWNED_TYPE_LABELS[item.bucket] || item.bucket || "").toLowerCase();
    case "created_at":
    case "modified_at":
    case "last_accessed_at": {
      const raw = item[key] || "";
      if (!raw) {
        return 0;
      }
      const normalized = raw.includes(" ") && !raw.includes("T") ? raw.replace(" ", "T") : raw;
      const value = Date.parse(normalized);
      return Number.isNaN(value) ? 0 : value;
    }
    case "owner":
      return (viewState.owned.owner?.username || "").toLowerCase();
    default:
      return (item[key] || "").toString().toLowerCase();
  }
}

function sortOwnedItems(items) {
  const { key, direction } = viewState.owned.sort;
  const factor = direction === "desc" ? -1 : 1;
  return [...items].sort((a, b) => {
    const aValue = ownedSortValue(a, key);
    const bValue = ownedSortValue(b, key);
    if (aValue === bValue) {
      return 0;
    }
    if (typeof aValue === "number" && typeof bValue === "number") {
      return aValue > bValue ? factor : -factor;
    }
    return aValue > bValue ? factor : -factor;
  });
}

function updateOwnedSortIndicators() {
  if (!Array.isArray(elements.ownedSortHeaders)) {
    return;
  }
  const { key, direction } = viewState.owned.sort;
  elements.ownedSortHeaders.forEach((header) => {
    if (!header) {
      return;
    }
    const sortKey = header.getAttribute("data-admin-owned-sort");
    if (sortKey === key) {
      header.setAttribute("aria-sort", direction === "desc" ? "descending" : "ascending");
    } else {
      header.setAttribute("aria-sort", "none");
    }
  });
}

function defaultOwnedSortDirection(key) {
  if (key === "created_at" || key === "last_accessed_at" || key === "modified_at") {
    return "desc";
  }
  return "asc";
}

function setOwnedSort(key) {
  if (!key) {
    return;
  }
  if (viewState.owned.sort.key === key) {
    viewState.owned.sort.direction = viewState.owned.sort.direction === "asc" ? "desc" : "asc";
  } else {
    viewState.owned.sort = { key, direction: defaultOwnedSortDirection(key) };
  }
  renderOwnedItems(viewState.owned.items, viewState.owned.owner);
}

function renderOwnedItems(rawItems, owner) {
  if (!elements.ownedBody) {
    return;
  }
  const selectedType = viewState.owned.selectedType;
  const items = selectedType ? (rawItems || []).filter((item) => item.bucket === selectedType) : rawItems;
  if (!Array.isArray(items) || !items.length) {
    const viewingEveryone = viewState.owned.selectedUsername === "__all__";
    const message = viewingEveryone
      ? "No content available."
      : selectedType
        ? "No saved content of this type yet."
        : "No saved content yet.";
    showOwnedEmpty(message);
    updateOwnedSummary(owner, 0);
    updateOwnedSortIndicators();
    return;
  }
  if (elements.ownedTable) {
    elements.ownedTable.hidden = false;
  }
  if (elements.ownedEmpty) {
    elements.ownedEmpty.hidden = true;
  }
  const fragment = document.createDocumentFragment();
  const sortedItems = sortOwnedItems(items);
  sortedItems.forEach((item) => {
    const row = document.createElement("tr");

    const nameCell = document.createElement("td");
    const namePrimary = document.createElement("div");
    namePrimary.className = "fw-semibold";
    namePrimary.textContent = item.label || item.id;
    const nameSecondary = document.createElement("div");
    nameSecondary.className = "text-body-secondary small";
    nameSecondary.textContent = item.id;
    nameCell.appendChild(namePrimary);
    nameCell.appendChild(nameSecondary);

    const typeCell = document.createElement("td");
    typeCell.textContent = OWNED_TYPE_LABELS[item.bucket] || item.bucket;

    const createdCell = document.createElement("td");
    createdCell.textContent = formatTimestamp(item.created_at, "Unknown");

    const accessedCell = document.createElement("td");
    accessedCell.textContent = formatTimestamp(item.last_accessed_at, "Never");

    const shareCell = document.createElement("td");
    shareCell.className = "text-end";
    const ownerCell = document.createElement("td");
    ownerCell.className = "text-end";

    const ownerRow = document.createElement("div");
    ownerRow.className = "d-flex flex-wrap justify-content-end gap-2 align-items-center";
    const ownerSelect = document.createElement("select");
    ownerSelect.className = "form-select form-select-sm w-auto";
    ownerSelect.setAttribute("aria-label", `Change owner for ${item.label || item.id}`);
    const currentOwnerUsername = item.owner_username || owner?.username || "";
    const currentOwnerTier = item.owner_tier || owner?.tier || "";
    const shareButton = document.createElement("button");
    shareButton.type = "button";
    shareButton.className = "btn btn-outline-primary btn-sm";
    shareButton.textContent = "Share";
    shareButton.addEventListener("click", () => {
      shareModal.open({
        bucket: item.bucket,
        id: item.id,
        label: item.label || item.id,
        typeLabel: OWNED_TYPE_LABELS[item.bucket] || item.bucket,
      });
    });

    shareCell.appendChild(shareButton);

    const ownerOptions = buildOwnerOptions(item.bucket, { username: currentOwnerUsername, tier: currentOwnerTier });
    ownerOptions.forEach((option) => {
      const opt = document.createElement("option");
      opt.value = option.value;
      opt.textContent = option.label;
      if (option.disabled) {
        opt.disabled = true;
      }
      if (option.value === currentOwnerUsername) {
        opt.selected = true;
      }
      ownerSelect.appendChild(opt);
    });
    if (!ownerOptions.length) {
      const opt = document.createElement("option");
      opt.value = "";
      opt.textContent = currentOwnerUsername ? describeOwnerOption(currentOwnerUsername, currentOwnerTier) : "Unassigned";
      opt.selected = true;
      opt.disabled = true;
      ownerSelect.appendChild(opt);
    }
    ownerSelect.value = currentOwnerUsername;
    ownerSelect.disabled = !isAdminSession() || ownerOptions.length <= 1;

    const deleteButton = document.createElement("button");
    deleteButton.type = "button";
    deleteButton.className = "btn btn-outline-danger btn-sm";
    deleteButton.textContent = "Delete";

    if (isAdminSession()) {
      ownerSelect.addEventListener("change", async () => {
        const selected = ownerSelect.value;
        if (!selected || selected === currentOwnerUsername) {
          ownerSelect.value = currentOwnerUsername;
          return;
        }
        ownerSelect.disabled = true;
        deleteButton.disabled = true;
        try {
          await dataManager.updateContentOwner(item.bucket, item.id, selected);
          if (status) {
            status.show(`Transferred ownership to ${selected}.`, { type: "success", timeout: 2000 });
          }
          await loadOwnedContent({ refresh: true });
        } catch (error) {
          console.error("Failed to change owner", error);
          if (status) {
            status.show(error.message || "Unable to update owner", { type: "danger" });
          }
          ownerSelect.value = currentOwnerUsername;
          ownerSelect.disabled = false;
          deleteButton.disabled = false;
        }
      });
    }

    deleteButton.addEventListener("click", async () => {
      const typeLabel = OWNED_TYPE_LABELS[item.bucket] || item.bucket;
      if (!confirmDelete({ label: `this ${typeLabel.toLowerCase()}` })) {
        return;
      }
      deleteButton.disabled = true;
      ownerSelect.disabled = true;
      try {
        await dataManager.delete(item.bucket, item.id, { mode: "remote" });
        if (status) {
          status.show(`${typeLabel} deleted.`, { type: "success", timeout: 2000 });
        }
        await loadOwnedContent({ refresh: true });
      } catch (error) {
        console.error("Failed to delete content", error);
        if (status) {
          status.show(error.message || "Unable to delete content", { type: "danger" });
        }
        deleteButton.disabled = false;
        ownerSelect.disabled = !isAdminSession() || ownerOptions.length <= 1;
      }
    });

    ownerRow.appendChild(ownerSelect);
    ownerRow.appendChild(deleteButton);

    ownerCell.appendChild(ownerRow);

    row.appendChild(nameCell);
    row.appendChild(typeCell);
    row.appendChild(createdCell);
    row.appendChild(accessedCell);
    row.appendChild(shareCell);
    row.appendChild(ownerCell);
    fragment.appendChild(row);
  });

  elements.ownedBody.replaceChildren(fragment);
  updateOwnedSummary(owner, items.length);
  updateOwnedSortIndicators();
}

function isViewingCurrentUser() {
  const current = currentUser();
  if (!current) {
    return false;
  }
  if (viewState.owned.selectedUsername === "__all__") {
    return false;
  }
  return !viewState.owned.selectedUsername || viewState.owned.selectedUsername === current.username;
}

async function loadOwnedContent({ refresh = false } = {}) {
  if (!elements.ownedBody) {
    return;
  }
  if (!dataManager.isAuthenticated()) {
    viewState.owned.owner = null;
    viewState.owned.items = [];
    viewState.owned.stale = true;
    showOwnedEmpty("Sign in to see your saved content.");
    updateOwnedSummary(null, 0);
    updateOwnedSortIndicators();
    return;
  }
  if (viewState.owned.loading) {
    return;
  }
  viewState.owned.loading = true;
  const shouldRefresh = refresh || viewState.owned.stale;
  if (shouldRefresh || !viewState.owned.items.length) {
    setOwnedLoading();
  }
  const viewingEveryone = viewState.owned.selectedUsername === "__all__";
  const username = viewingEveryone ? "" : viewState.owned.selectedUsername || "";
  const scope = viewingEveryone ? "all" : "";
  try {
    const payload = await dataManager.listOwnedContent({ username, scope, refresh: shouldRefresh });
    const owner = payload?.owner || null;
    const items = Array.isArray(payload?.items) ? payload.items : [];
    viewState.owned.owner = owner;
    viewState.owned.items = items;
    viewState.owned.stale = false;
    populateOwnedTypeFilter();
    renderOwnedItems(items, owner);
  } catch (error) {
    console.error("Failed to load owned content", error);
    if (status) {
      status.show(error.message || "Unable to load content", { type: "danger" });
    }
    setOwnedLoading("Unable to load content");
    updateOwnedSortIndicators();
  } finally {
    viewState.owned.loading = false;
  }
}

function handleOwnedContentEvent() {
  if (!dataManager.isAuthenticated()) {
    return;
  }
  const viewingEveryone = viewState.owned.selectedUsername === "__all__";
  const relevant = isViewingCurrentUser() || viewingEveryone;
  if (!relevant) {
    return;
  }
  if (viewState.activeTab === TAB_OWNED) {
    loadOwnedContent({ refresh: true });
  } else {
    viewState.owned.stale = true;
  }
}

if (elements.openLogin && auth) {
  elements.openLogin.addEventListener("click", () => auth.showLogin());
}

function setEmailError(message = "") {
  if (elements.emailError) {
    elements.emailError.textContent = message;
  }
}

function setPasswordError(message = "") {
  if (elements.passwordError) {
    elements.passwordError.textContent = message;
  }
}


function handleAuthChanged() {
  renderQuickReference();
  const user = currentUser();
  if (user) {
    showPanel();
    populateSettings({ force: true });
    if (isAdminSession()) {
      void loadUsers({ force: true });
    }
    populateOwnedUserFilter();
    viewState.owned.selectedUsername = "";
    viewState.owned.stale = true;
    loadOwnedContent({ refresh: true });
    setActiveTab(resolveTabFromHash(), { updateHash: false, force: true });
  } else {
    showGate();
    viewState.users = [];
    viewState.owned.owner = null;
    viewState.owned.items = [];
    viewState.owned.selectedUsername = "";
    viewState.owned.stale = true;
    populateOwnedUserFilter();
    showOwnedEmpty("Sign in to see your saved content.");
    updateOwnedSummary(null, 0);
    setActiveTab(TAB_SETTINGS, { updateHash: false, force: true });
  }
}

window.addEventListener("undercroft:auth-changed", () => {
  handleAuthChanged();
});

window.addEventListener("hashchange", () => {
  setActiveTab(resolveTabFromHash(), { updateHash: false });
});

if (elements.tabs) {
  elements.tabs.addEventListener("click", (event) => {
    const button = event.target.closest("[data-admin-tab]");
    if (!button) {
      return;
    }
    const tab = button.getAttribute("data-admin-tab") || TAB_SETTINGS;
    setActiveTab(tab, { updateHash: true });
  });
}

if (elements.ownedUserSelect) {
  elements.ownedUserSelect.addEventListener("change", () => {
    viewState.owned.selectedUsername = elements.ownedUserSelect.value || "";
    viewState.owned.stale = true;
    loadOwnedContent({ refresh: true });
  });
}

if (elements.ownedTypeSelect) {
  elements.ownedTypeSelect.addEventListener("change", () => {
    viewState.owned.selectedType = elements.ownedTypeSelect.value || "";
    renderOwnedItems(viewState.owned.items, viewState.owned.owner);
  });
}

if (Array.isArray(elements.ownedSortHeaders)) {
  elements.ownedSortHeaders.forEach((header) => {
    if (!header) {
      return;
    }
    header.addEventListener("click", () => {
      const key = header.getAttribute("data-admin-owned-sort");
      setOwnedSort(key);
    });
    header.addEventListener("keydown", (event) => {
      if (event.key === "Enter" || event.key === " ") {
        event.preventDefault();
        const key = header.getAttribute("data-admin-owned-sort");
        setOwnedSort(key);
      }
    });
  });
}

updateOwnedSortIndicators();

if (elements.favoriteColorInput) {
  elements.favoriteColorInput.addEventListener("change", async () => {
    if (!dataManager.isAuthenticated()) {
      return;
    }
    setFavoriteColorUnset(false);
    try {
      await dataManager.saveUserSettings({ favoriteColor: elements.favoriteColorInput.value });
      status?.show("Favorite color saved", { type: "success", timeout: 1500 });
    } catch (error) {
      status?.show(error.message || "Unable to save your favorite color.", { type: "error" });
    }
  });
}

if (elements.favoriteColorClear) {
  elements.favoriteColorClear.addEventListener("click", async () => {
    if (!dataManager.isAuthenticated()) {
      return;
    }
    setFavoriteColorUnset(true);
    try {
      // "" (not deleting the key) — dataManager.saveUserSettings is a
      // merge-patch, and the read side above already treats a falsy
      // favoriteColor exactly like a missing one, so this is a real,
      // explicit "the user chose to clear this," not silent data loss.
      await dataManager.saveUserSettings({ favoriteColor: "" });
      status?.show("Favorite color cleared", { type: "info", timeout: 1500 });
    } catch (error) {
      status?.show(error.message || "Unable to clear your favorite color.", { type: "error" });
    }
  });
}

populateDiceThemeOptions();

if (elements.diceThemeSelect) {
  elements.diceThemeSelect.addEventListener("change", () => {
    const theme = elements.diceThemeSelect.value;
    refreshDiceColorVisibility(theme);
    // Switching themes always resets the swatch to THIS theme's own default
    // color — never a blank, and never the previous theme's color carried
    // over somewhere it was never chosen for.
    if (elements.diceColorInput) {
      elements.diceColorInput.value = getThemeDefaultColor(theme);
    }
    void saveDiceSettings();
  });
}

if (elements.diceColorInput) {
  elements.diceColorInput.addEventListener("change", () => void saveDiceSettings());
}

if (elements.diceColorReset) {
  elements.diceColorReset.addEventListener("click", () => {
    if (elements.diceColorInput) {
      elements.diceColorInput.value = getThemeDefaultColor(elements.diceThemeSelect?.value || "default");
    }
    void saveDiceSettings();
  });
}

if (elements.dicePreview) {
  elements.dicePreview.addEventListener("click", async () => {
    const theme = elements.diceThemeSelect?.value || "default";
    const themeColor = getThemeColorSupport(theme) ? elements.diceColorInput?.value || "" : "";
    const ok = await previewDiceTheme(theme, themeColor);
    if (!ok) {
      status?.show("Unable to preview that theme right now.", { type: "error" });
    }
  });
}

if (elements.emailForm) {
  elements.emailForm.addEventListener("submit", async (event) => {
    event.preventDefault();
    setEmailError("");
    const formData = new FormData(elements.emailForm);
    const email = String(formData.get("email") || "").trim();
    const password = String(formData.get("password") || "");
    const user = currentUser();
    if (!email) {
      setEmailError("Email is required");
      return;
    }
    if (user && email.toLowerCase() === String(user.email || "").toLowerCase()) {
      setEmailError("That is already your email address");
      return;
    }
    if (!password) {
      setEmailError("Password is required");
      return;
    }
    disableForm(elements.emailForm, true);
    try {
      const result = await dataManager.updateEmail({ email, password });
      if (result && result.user) {
        populateSettings({ force: true });
        if (status) {
          status.show("Email updated", { type: "success", timeout: 2000 });
        }
        if (auth && typeof auth.refreshDisplay === "function") {
          auth.refreshDisplay();
        }
      }
    } catch (error) {
      setEmailError(error.message || "Unable to update email");
    } finally {
      disableForm(elements.emailForm, false);
      const passwordField = elements.emailForm.querySelector("[name='password']");
      if (passwordField) {
        passwordField.value = "";
      }
    }
  });
}

if (elements.passwordForm) {
  elements.passwordForm.addEventListener("submit", async (event) => {
    event.preventDefault();
    setPasswordError("");
    const formData = new FormData(elements.passwordForm);
    const currentPassword = String(formData.get("current_password") || "");
    const newPassword = String(formData.get("new_password") || "");
    const confirmPassword = String(formData.get("confirm_password") || "");
    if (!currentPassword) {
      setPasswordError("Current password is required");
      return;
    }
    if (newPassword.length < 8) {
      setPasswordError("New password must be at least 8 characters long");
      return;
    }
    if (newPassword !== confirmPassword) {
      setPasswordError("New passwords do not match");
      return;
    }
    disableForm(elements.passwordForm, true);
    try {
      await dataManager.updatePassword({ current_password: currentPassword, new_password: newPassword });
      elements.passwordForm.reset();
      if (status) {
        status.show("Password updated", { type: "success", timeout: 2000 });
      }
    } catch (error) {
      setPasswordError(error.message || "Unable to change password");
    } finally {
      disableForm(elements.passwordForm, false);
    }
  });
}

// ===== Help topic browser (left pane) =========================================
// Admin is the one place every tool's inline (?) help triggers now deep-link
// to (see common/js/lib/help.js) — this pane is what they land on, and it's
// also just directly browsable/searchable on its own, independent of the
// admin-gated content in the main panel (this pane isn't behind the sign-in
// gate at all). The actual search/browse/detail wiring lives in
// common/js/lib/help-browser.js, shared with the Dashboard's own copy (which
// adds pinning on top of the same module).
let helpBrowserApi = null;

async function initHelpBrowser() {
  helpBrowserApi = await initHelpBrowserModule({
    topicsUrl: "data/help-topics.json",
    pane: elements.leftPane ? { element: elements.leftPane, toggle: elements.leftPaneToggle } : null,
  });
}

// Exposed on window so the quick-reference steps below (and, in principle,
// any other same-page control) can jump straight to a topic without a full
// navigation — the generic data-help-topic mechanism (help.js) is for
// triggers OUTSIDE this page, which have to open Admin in a new tab instead.
function showHelpTopic(topicId) {
  helpBrowserApi?.showTopic(topicId);
}

// ===== Campaign quick reference (left pane) ===================================
// Creating a group requires GM tier or higher (server/groups.py's
// _CREATE_GROUP_MIN_TIER) — the same tier this whole panel is gated on, so
// everyone who can see this guide can actually complete every step in it.
const QUICK_REFERENCE_STEPS = [
  {
    title: "Create a Campaign Group",
    description: "Requires GM tier or higher — this whole guide only shows once you qualify. Manage groups from the Groups tab in Loom.",
    helpTopic: "campaign.groups",
    href: loomHref,
    tabLabel: "Open Loom",
  },
  {
    title: "Add your players' characters",
    description: "Open the group's row in Loom's Groups tab and pick characters for its roster.",
    helpTopic: "admin.groups.members",
    href: loomHref,
    tabLabel: "Open Loom",
  },
  {
    title: "Pick it as your Active Campaign",
    description:
      "Use the Campaign dropdown in the header, next to your account menu — it's on every tool once you're signed in.",
    helpTopic: "campaign.active",
  },
  {
    title: "Share what the table needs",
    description:
      'From any tool’s Save/Export toolbar, or this page’s Share button, choose "Share with [your campaign]" for one click.',
    helpTopic: "campaign.sharing",
  },
  {
    title: "Show something live",
    description:
      "Add a Handout widget to your Dashboard (or a Map widget for maps) and click its eye icon — that's what the table sees.",
    helpTopic: "campaign.spotlight",
  },
  {
    title: "Give players a way in",
    description:
      "Grab the group's public share link from Loom's Groups tab so players without accounts can watch the Game Log and Now Showing panel.",
    helpTopic: "campaign.gamelog",
    href: loomHref,
    tabLabel: "Open Loom",
  },
];

function renderQuickReference() {
  if (!elements.quickReference) return;
  elements.quickReference.innerHTML = "";
  const user = currentUser();
  const eligible = user && roleRank(user.tier) >= roleRank("gm");
  if (!eligible) {
    const heading = document.createElement("h2");
    heading.className = "text-uppercase fs-6 fw-semibold text-body-secondary";
    heading.textContent = "Running a Campaign";
    const message = document.createElement("p");
    message.className = "small text-body-secondary mb-0";
    message.textContent = user
      ? "Campaign tools (Groups, sharing, live Show-to-table) are available at GM tier and above."
      : "Sign in at GM tier or above to see the campaign quick-start guide here.";
    elements.quickReference.append(heading, message);
    return;
  }
  const header = document.createElement("div");
  const heading = document.createElement("h2");
  heading.className = "text-uppercase fs-6 fw-semibold text-body-secondary mb-1";
  heading.textContent = "Running a Campaign";
  const subtitle = document.createElement("p");
  subtitle.className = "small text-body-secondary mb-0";
  subtitle.textContent = "A step-by-step path from “I GM” to a live table.";
  header.append(heading, subtitle);
  elements.quickReference.appendChild(header);

  const list = document.createElement("ol");
  list.className = "list-unstyled d-flex flex-column gap-3 mb-0";
  QUICK_REFERENCE_STEPS.forEach((step, index) => {
    const item = document.createElement("li");
    item.className = "d-flex gap-2";

    const badge = document.createElement("span");
    badge.className =
      "badge rounded-pill text-bg-secondary flex-shrink-0 d-flex align-items-center justify-content-center";
    badge.style.width = "1.5rem";
    badge.style.height = "1.5rem";
    badge.textContent = String(index + 1);

    const body = document.createElement("div");
    body.className = "d-flex flex-column gap-1";

    const titleRow = document.createElement("div");
    titleRow.className = "d-flex align-items-center gap-1";
    const title = document.createElement("span");
    title.className = "fw-semibold small";
    title.textContent = step.title;
    titleRow.appendChild(title);
    if (step.helpTopic) {
      const helpButton = document.createElement("button");
      helpButton.type = "button";
      helpButton.className = "btn btn-link p-0 text-body-secondary d-inline-flex";
      helpButton.setAttribute("aria-label", `More about: ${step.title}`);
      helpButton.innerHTML = '<span class="iconify" data-icon="tabler:help" aria-hidden="true"></span>';
      helpButton.addEventListener("click", () => showHelpTopic(step.helpTopic));
      titleRow.appendChild(helpButton);
    }
    body.appendChild(titleRow);

    const description = document.createElement("p");
    description.className = "text-body-secondary small mb-0";
    description.textContent = step.description;
    body.appendChild(description);

    if (step.href) {
      const goLink = document.createElement("a");
      goLink.href = step.href;
      goLink.className = "btn btn-outline-secondary btn-sm align-self-start";
      goLink.textContent = step.tabLabel || "Go";
      body.appendChild(goLink);
    }

    item.append(badge, body);
    list.appendChild(item);
  });
  elements.quickReference.appendChild(list);
}

window.addEventListener("workbench:content-saved", handleOwnedContentEvent);
window.addEventListener("workbench:content-deleted", handleOwnedContentEvent);

handleAuthChanged();
// Same-page shortcut for Admin's own inline (?) help triggers (see
// common/js/lib/help.js) — clicking one here jumps straight to the topic in
// this page's own right-pane browser instead of opening a redundant second
// tab pointed at itself.
window.addEventListener("undercroft:show-help-topic", (event) => {
  const topicId = event.detail?.topicId;
  if (topicId) {
    showHelpTopic(topicId);
  }
});

void initHelpBrowser();
