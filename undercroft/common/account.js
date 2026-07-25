import { initAppShell, resolveToolHref, resolveToolContextPath } from "./js/lib/app-shell.js";
import { DataManager } from "./js/lib/data-manager.js";
import { resolveApiBase } from "./js/lib/api.js";
import { initAuthControls } from "./js/lib/auth-ui.js";
import { initHelpSystem, loadHelpTopics } from "./js/lib/help.js";
import { expandPane } from "./js/lib/panes.js";
import { initShareModal } from "./js/lib/share-modal.js";

const { status } = initAppShell({ namespace: "account" });
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
  helpBrowserSearch: document.querySelector("[data-help-browser-search]"),
  helpBrowserList: document.querySelector("[data-help-browser-list]"),
  helpBrowserDetail: document.querySelector("[data-help-browser-detail]"),
  helpBrowserBack: document.querySelector("[data-help-browser-back]"),
  helpBrowserDetailTitle: document.querySelector("[data-help-browser-detail-title]"),
  helpBrowserDetailCategory: document.querySelector("[data-help-browser-detail-category]"),
  helpBrowserDetailSummary: document.querySelector("[data-help-browser-detail-summary]"),
  helpBrowserDetailList: document.querySelector("[data-help-browser-detail-list]"),
  rightPane: document.querySelector('[data-pane="right"]'),
  rightPaneToggle: document.querySelector('[data-pane-toggle="right"]'),
  emailForm: document.querySelector("[data-admin-email-form]"),
  emailError: document.querySelector("[data-admin-email-error]"),
  emailInput: document.getElementById("admin-settings-email"),
  passwordForm: document.querySelector("[data-admin-password-form]"),
  passwordError: document.querySelector("[data-admin-password-error]"),
  passwordConfirm: document.getElementById("admin-settings-password-confirm"),
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

const OWNER_ROLE_REQUIREMENTS = {
  character: ["player", "gm", "creator", "admin"],
  template: ["gm", "creator", "admin"],
  system: ["creator", "admin"],
};

const ROLE_RANKS = {
  free: 0,
  player: 1,
  gm: 2,
  creator: 3,
  admin: 4,
};

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

function normalizeTier(tier) {
  return typeof tier === "string" ? tier.trim().toLowerCase() : "";
}

function tierRank(tier) {
  const normalized = normalizeTier(tier);
  return normalized in ROLE_RANKS ? ROLE_RANKS[normalized] : -1;
}

function tierMeetsOwnerRequirement(tier, bucket) {
  const normalized = normalizeTier(tier);
  const allowed = OWNER_ROLE_REQUIREMENTS[bucket];
  if (!allowed || !allowed.length) {
    return true;
  }
  const minRank = Math.min(
    ...allowed
      .map((role) => tierRank(role))
      .filter((rank) => rank >= 0),
  );
  if (!Number.isFinite(minRank)) {
    return true;
  }
  return tierRank(normalized) >= minRank;
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
      const confirmed = window.confirm(`Delete this ${typeLabel.toLowerCase()}? This cannot be undone.`);
      if (!confirmed) {
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

function disableForm(form, disabled) {
  if (!form) return;
  Array.from(form.elements).forEach((element) => {
    if (typeof element.disabled !== "undefined") {
      element.disabled = disabled;
    }
  });
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

// ===== Help topic browser (right pane) =======================================
// Admin is the one place every tool's inline (?) help triggers now deep-link
// to (see common/js/lib/help.js) — this pane is what they land on, and it's
// also just directly browsable/searchable on its own, independent of the
// admin-gated content in the main panel (this pane isn't behind the sign-in
// gate at all).
let helpTopicsList = [];
let helpTopicsById = new Map();

function groupHelpTopicsByCategory(topics) {
  const grouping = new Map();
  topics.forEach((topic) => {
    const category = topic.category || "General";
    if (!grouping.has(category)) {
      grouping.set(category, []);
    }
    grouping.get(category).push(topic);
  });
  return Array.from(grouping.entries());
}

function renderHelpBrowserList(topics) {
  if (!elements.helpBrowserList) return;
  elements.helpBrowserList.innerHTML = "";
  if (!topics.length) {
    const empty = document.createElement("p");
    empty.className = "text-body-secondary small mb-0";
    empty.textContent = "No matching topics.";
    elements.helpBrowserList.appendChild(empty);
    return;
  }
  groupHelpTopicsByCategory(topics).forEach(([category, entries]) => {
    const heading = document.createElement("div");
    heading.className = "text-uppercase small fw-semibold text-body-secondary mt-2";
    heading.textContent = category;
    elements.helpBrowserList.appendChild(heading);
    entries.forEach((topic) => {
      const button = document.createElement("button");
      button.type = "button";
      button.className = "btn btn-link text-start p-1 text-decoration-none link-body-emphasis small";
      button.textContent = topic.title;
      button.addEventListener("click", () => showHelpTopic(topic.id));
      elements.helpBrowserList.appendChild(button);
    });
  });
}

// Exposed on window so the quick-reference steps below (and, in principle,
// any other same-page control) can jump straight to a topic without a full
// navigation — the generic data-help-topic mechanism (help.js) is for
// triggers OUTSIDE this page, which have to open Admin in a new tab instead.
function showHelpTopic(topicId) {
  const topic = helpTopicsById.get(topicId);
  if (!topic) {
    return;
  }
  if (elements.helpBrowserSearch) elements.helpBrowserSearch.classList.add("d-none");
  if (elements.helpBrowserList) elements.helpBrowserList.classList.add("d-none");
  if (elements.helpBrowserDetail) {
    elements.helpBrowserDetail.classList.remove("d-none");
    elements.helpBrowserDetail.classList.add("d-flex");
  }
  if (elements.helpBrowserDetailTitle) elements.helpBrowserDetailTitle.textContent = topic.title;
  if (elements.helpBrowserDetailCategory) elements.helpBrowserDetailCategory.textContent = topic.category;
  if (elements.helpBrowserDetailSummary) elements.helpBrowserDetailSummary.textContent = topic.summary;
  if (elements.helpBrowserDetailList) {
    elements.helpBrowserDetailList.innerHTML = "";
    (topic.details || []).forEach((line) => {
      const item = document.createElement("li");
      item.textContent = line;
      elements.helpBrowserDetailList.appendChild(item);
    });
  }
  // Expanding here matters for the ?help=<id> deep link specifically — a
  // fresh page load has the right pane already expanded (data-pane-initial),
  // but jumping to a topic should never leave it looking collapsed/empty if
  // something else changed that in the meantime.
  if (elements.rightPane) {
    expandPane(elements.rightPane, elements.rightPaneToggle);
  }
}

function hideHelpTopicDetail() {
  if (elements.helpBrowserDetail) {
    elements.helpBrowserDetail.classList.add("d-none");
    elements.helpBrowserDetail.classList.remove("d-flex");
  }
  if (elements.helpBrowserList) elements.helpBrowserList.classList.remove("d-none");
  if (elements.helpBrowserSearch) elements.helpBrowserSearch.classList.remove("d-none");
}

async function initHelpBrowser() {
  try {
    const { topics, map } = await loadHelpTopics("data/help-topics.json");
    helpTopicsList = topics;
    helpTopicsById = map;
  } catch (error) {
    if (elements.helpBrowserList) {
      elements.helpBrowserList.innerHTML =
        '<p class="text-danger small mb-0">Unable to load help topics.</p>';
    }
    return;
  }
  renderHelpBrowserList(helpTopicsList);
  if (elements.helpBrowserSearch) {
    elements.helpBrowserSearch.addEventListener("input", () => {
      const query = elements.helpBrowserSearch.value.trim().toLowerCase();
      if (!query) {
        renderHelpBrowserList(helpTopicsList);
        return;
      }
      const filtered = helpTopicsList.filter(
        (topic) =>
          topic.title.toLowerCase().includes(query) ||
          topic.summary.toLowerCase().includes(query) ||
          topic.category.toLowerCase().includes(query)
      );
      renderHelpBrowserList(filtered);
    });
  }
  if (elements.helpBrowserBack) {
    elements.helpBrowserBack.addEventListener("click", hideHelpTopicDetail);
  }
  // ?help=<topicId> — how every OTHER tool's inline (?) help icons land here
  // (see common/js/lib/help.js's default href).
  const requestedTopic = new URLSearchParams(window.location.search).get("help");
  if (requestedTopic) {
    showHelpTopic(requestedTopic);
  }
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
      'Pick "Show this item…" from the Campaign dropdown while something’s loaded in Sanctum, Forge, Crucible, Vault, or Orrery.',
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
  const eligible = user && tierRank(user.tier) >= tierRank("gm");
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
