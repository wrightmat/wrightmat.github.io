import { initAppShell } from "../lib/app-shell.js";
import { DataManager } from "../lib/data-manager.js";
import { resolveApiBase } from "../lib/api.js";
import { initAuthControls } from "../lib/auth-ui.js";

const { status } = initAppShell({ namespace: "admin" });
const dataManager = new DataManager({ baseUrl: resolveApiBase() });
const auth = initAuthControls({ root: document, status, dataManager });

const elements = {
  panel: document.querySelector("[data-admin-panel]"),
  gate: document.querySelector("[data-admin-gate]"),
  usersBody: document.querySelector("[data-admin-users]"),
  openLogin: document.querySelector("[data-admin-open-login]"),
  tabs: document.querySelector("[data-admin-tabs]"),
  tabButtons: Array.from(document.querySelectorAll("[data-admin-tab]")),
  tabPanels: Array.from(document.querySelectorAll("[data-admin-tab-panel]")),
  usersTab: document.querySelector("[data-admin-users-tab]"),
  ownedTable: document.querySelector("[data-admin-owned-table]"),
  ownedBody: document.querySelector("[data-admin-owned-rows]"),
  ownedEmpty: document.querySelector("[data-admin-owned-empty]"),
  ownedSummary: document.querySelector("[data-admin-owned-summary]"),
  ownedUserSelect: document.querySelector("[data-admin-owned-user]"),
  ownedFilter: document.querySelector("[data-admin-owned-filter]"),
  ownedSortHeaders: Array.from(document.querySelectorAll("[data-admin-owned-sort]")),
  userSortHeaders: Array.from(document.querySelectorAll("[data-admin-users-sort]")),
  emailForm: document.querySelector("[data-admin-email-form]"),
  emailError: document.querySelector("[data-admin-email-error]"),
  emailInput: document.getElementById("admin-settings-email"),
  passwordForm: document.querySelector("[data-admin-password-form]"),
  passwordError: document.querySelector("[data-admin-password-error]"),
  passwordConfirm: document.getElementById("admin-settings-password-confirm"),
  shareModal: document.getElementById("admin-share-modal"),
  shareModalTitle: document.querySelector("[data-admin-share-title]"),
  shareLinkGroup: document.querySelector("[data-admin-share-link-group]"),
  shareLinkInput: document.querySelector("[data-admin-share-link]"),
  shareLinkCopy: document.querySelector("[data-admin-share-copy]"),
  shareLinkGenerate: document.querySelector("[data-admin-share-generate]"),
  shareLinkDisable: document.querySelector("[data-admin-share-disable]"),
  shareLinkStatus: document.querySelector("[data-admin-share-link-status]"),
  shareLinkHelp: document.querySelector("[data-admin-share-link-help]"),
  shareAddForm: document.querySelector("[data-admin-share-add-form]"),
  shareUsername: document.querySelector("[data-admin-share-username]"),
  sharePermission: document.querySelector("[data-admin-share-permission]"),
  shareTable: document.querySelector("[data-admin-share-table]"),
  shareRows: document.querySelector("[data-admin-share-rows]"),
  shareEmpty: document.querySelector("[data-admin-share-empty]"),
};

const TIER_OPTIONS = [
  { value: "free", label: "Free" },
  { value: "player", label: "Player" },
  { value: "gm", label: "GM" },
  { value: "creator", label: "Creator" },
  { value: "admin", label: "Admin" },
];

const OWNED_TYPE_LABELS = {
  characters: "Character",
  templates: "Template",
  systems: "System",
};

const BUCKET_TO_CONTENT_TYPE = {
  characters: "character",
  templates: "template",
  systems: "system",
};

const OWNER_ROLE_REQUIREMENTS = {
  characters: ["player", "gm", "master", "creator", "admin"],
  templates: ["gm", "master", "creator", "admin"],
  systems: ["creator", "admin"],
};

const ROLE_RANKS = {
  free: 0,
  player: 1,
  gm: 2,
  master: 3,
  creator: 4,
  admin: 5,
};

const TAB_SETTINGS = "settings";
const TAB_OWNED = "owned";
const TAB_USERS = "users";
const AVAILABLE_TABS = [TAB_SETTINGS, TAB_OWNED, TAB_USERS];

const dateFormatter = typeof Intl !== "undefined" && typeof Intl.DateTimeFormat === "function"
  ? new Intl.DateTimeFormat(undefined, { dateStyle: "medium", timeStyle: "short" })
  : null;

const viewState = {
  activeTab: TAB_SETTINGS,
  users: [],
  usersSort: { key: "username", direction: "asc" },
  owned: {
    owner: null,
    items: [],
    selectedUsername: "",
    loading: false,
    stale: true,
    sort: { key: "last_accessed_at", direction: "desc" },
  },
};

const shareState = {
  modal: null,
  record: null,
  shares: [],
  link: null,
  loading: false,
  linkStatus: "",
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
  if (elements.usersBody) {
    elements.usersBody.innerHTML = "";
  }
}

function setLoading(message = "Loading users…") {
  if (!elements.usersBody) return;
  const row = document.createElement("tr");
  row.innerHTML = `<td colspan="4" class="text-center py-4 text-body-secondary">${message}</td>`;
  elements.usersBody.replaceChildren(row);
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
  const admin = isAdminSession();
  const target = name === TAB_USERS && !admin ? TAB_SETTINGS : name;
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
  if (target === TAB_USERS && admin) {
    loadUsers();
  }
  if (target === TAB_OWNED) {
    if (admin && !viewState.users.length) {
      void loadUsers({ showSpinner: false, force: true });
    }
    populateOwnedUserFilter();
    loadOwnedContent();
  }
}

function updateTabAvailability() {
  const admin = isAdminSession();
  if (elements.usersTab) {
    elements.usersTab.classList.toggle("d-none", !admin);
    const button = elements.usersTab.querySelector("[data-admin-tab]");
    if (button) {
      button.disabled = !admin;
    }
  }
  if (!admin && viewState.activeTab === TAB_USERS) {
    setActiveTab(TAB_SETTINGS, { force: true });
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

function renderUsers(users) {
  if (!elements.usersBody) return;
  if (!users.length) {
    setLoading("No registered users yet.");
    updateUserSortIndicators();
    return;
  }
  const currentUser = dataManager.session?.user;
  const sortedUsers = sortUsers(users);
  const fragment = document.createDocumentFragment();
  sortedUsers.forEach((user) => {
    const row = document.createElement("tr");
    const isSelf = currentUser && currentUser.username === user.username;
    const statusLabel = user.is_active ? "Active" : "Pending";
    const statusClass = user.is_active ? "text-bg-success" : "text-bg-warning";
    const lastActivity = formatLastActivity(user.last_activity || user.last_login || user.created_at);

    row.innerHTML = `
      <td class="fw-semibold">${user.username}</td>
      <td class="text-body-secondary">${user.email}</td>
      <td>
        <div class="d-flex align-items-center justify-content-between gap-2">
          <span class="text-body-secondary">${lastActivity}</span>
          <span class="badge ${statusClass}">${statusLabel}</span>
        </div>
      </td>
      <td class="text-end" data-admin-access>
        <div class="d-flex flex-wrap justify-content-end gap-2">
          <select class="form-select form-select-sm w-auto" data-admin-tier-select aria-label="Set tier for ${user.username}">
            ${TIER_OPTIONS.map((option) => `<option value="${option.value}">${option.label}</option>`).join("")}
          </select>
          <button type="button" class="btn btn-outline-danger btn-sm" data-admin-delete>Delete</button>
        </div>
      </td>
    `;

    const accessCell = row.querySelector("[data-admin-access]");
    const select = accessCell?.querySelector("[data-admin-tier-select]");
    const deleteBtn = accessCell?.querySelector("[data-admin-delete]");

    if (select) {
      select.value = user.tier;
      if (isSelf) {
        select.disabled = true;
        select.title = "You cannot change your own tier from this screen.";
      }
      select.addEventListener("change", async () => {
        const newTier = select.value;
        select.disabled = true;
        try {
          await dataManager.updateUserTier(user.username, newTier);
          user.tier = newTier;
          if (status) {
            status.show(`Updated ${user.username} to ${formatTier(newTier)} access.`, {
              type: "success",
              timeout: 2000,
            });
          }
        } catch (error) {
          if (status) {
            status.show(error.message || "Unable to update tier", { type: "danger" });
          }
          select.value = user.tier;
        } finally {
          select.disabled = isSelf;
        }
      });
    }

    if (deleteBtn) {
      deleteBtn.addEventListener("click", async () => {
        const confirmationMessage = isSelf
          ? "Delete your own account? This will immediately end your session."
          : `Delete ${user.username}? This cannot be undone.`;
        const confirmed = window.confirm(confirmationMessage);
        if (!confirmed) {
          return;
        }
        deleteBtn.disabled = true;
        if (select) {
          select.disabled = true;
        }
        try {
          await dataManager.deleteUser(user.username);
          if (status) {
            status.show(
              isSelf ? "Your account has been deleted." : `Deleted ${user.username}.`,
              { type: "success", timeout: 2000 },
            );
          }
          if (isSelf) {
            dataManager.clearSession();
            if (auth && typeof auth.refreshDisplay === "function") {
              auth.refreshDisplay();
            }
            window.dispatchEvent(new CustomEvent("workbench:auth-changed", { detail: { session: null } }));
          } else {
            row.remove();
            loadUsers({ showSpinner: false });
          }
        } catch (error) {
          if (status) {
            status.show(error.message || "Unable to delete user", { type: "danger" });
          }
          deleteBtn.disabled = false;
          if (select) {
            select.disabled = isSelf;
          }
        }
      });
    }

    fragment.appendChild(row);
  });
  elements.usersBody.replaceChildren(fragment);
  updateUserSortIndicators();
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

function formatLastActivity(value) {
  return formatTimestamp(value, "Never");
}

function userSortValue(user, key) {
  switch (key) {
    case "username":
      return (user.username || "").toLowerCase();
    case "email":
      return (user.email || "").toLowerCase();
    case "last_activity": {
      const source = user.last_activity || user.last_login || user.created_at || "";
      if (!source) {
        return 0;
      }
      const normalized = source.includes(" ") && !source.includes("T") ? source.replace(" ", "T") : source;
      const value = Date.parse(normalized);
      return Number.isNaN(value) ? 0 : value;
    }
    case "tier":
      return tierRank(user.tier);
    default:
      return (user[key] || "").toString().toLowerCase();
  }
}

function sortUsers(users) {
  const { key, direction } = viewState.usersSort;
  const factor = direction === "desc" ? -1 : 1;
  return [...users].sort((a, b) => {
    const aValue = userSortValue(a, key);
    const bValue = userSortValue(b, key);
    if (aValue === bValue) {
      return 0;
    }
    if (typeof aValue === "number" && typeof bValue === "number") {
      return aValue > bValue ? factor : -factor;
    }
    return aValue > bValue ? factor : -factor;
  });
}

function updateUserSortIndicators() {
  if (!Array.isArray(elements.userSortHeaders)) {
    return;
  }
  const { key, direction } = viewState.usersSort;
  elements.userSortHeaders.forEach((header) => {
    if (!header) {
      return;
    }
    const sortKey = header.getAttribute("data-admin-users-sort");
    if (sortKey === key) {
      header.setAttribute("aria-sort", direction === "desc" ? "descending" : "ascending");
    } else {
      header.setAttribute("aria-sort", "none");
    }
  });
}

function defaultUsersSortDirection(key) {
  if (key === "last_activity") {
    return "desc";
  }
  return "asc";
}

function setUsersSort(key) {
  if (!key) {
    return;
  }
  if (viewState.usersSort.key === key) {
    viewState.usersSort.direction = viewState.usersSort.direction === "asc" ? "desc" : "asc";
  } else {
    viewState.usersSort = { key, direction: defaultUsersSortDirection(key) };
  }
  renderUsers(viewState.users);
}

async function loadUsers({ showSpinner = true, force = false } = {}) {
  if (!isAdminSession()) {
    return;
  }
  const shouldRenderSpinner = showSpinner && viewState.activeTab === TAB_USERS;
  if (!force && viewState.activeTab !== TAB_USERS) {
    return;
  }
  if (shouldRenderSpinner) {
    setLoading();
  }
  try {
    const payload = await dataManager.listUsers();
    const users = Array.isArray(payload?.users) ? payload.users : [];
    viewState.users = users;
    renderUsers(users);
    populateOwnedUserFilter();
    if (viewState.activeTab === TAB_OWNED) {
      renderOwnedItems(viewState.owned.items, viewState.owned.owner);
    }
  } catch (error) {
    if (status) {
      status.show(error.message || "Unable to load users", { type: "danger" });
    }
    if (shouldRenderSpinner) {
      setLoading("Unable to load users");
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
  const current = currentUser();
  const currentUsername = current?.username || "";
  const selected = viewState.owned.selectedUsername || "";
  const fragment = document.createDocumentFragment();
  const selfOption = document.createElement("option");
  selfOption.value = "";
  selfOption.textContent = current
    ? `${current.username} (You)`
    : "My account";
  fragment.appendChild(selfOption);
  const uniqueUsers = new Map();
  viewState.users.forEach((user) => {
    if (!user || !user.username) return;
    if (user.username === currentUsername) {
      return;
    }
    uniqueUsers.set(user.username, user);
  });
  const sortedUsers = Array.from(uniqueUsers.values()).sort((a, b) =>
    a.username.localeCompare(b.username, undefined, { sensitivity: "base" }),
  );
  sortedUsers.forEach((user) => {
    const option = document.createElement("option");
    option.value = user.username;
    option.textContent = `${user.username} (${formatTier(user.tier)})`;
    fragment.appendChild(option);
  });
  select.replaceChildren(fragment);
  if (selected && (selected === currentUsername || uniqueUsers.has(selected))) {
    select.value = selected;
  } else {
    select.value = "";
    viewState.owned.selectedUsername = "";
  }
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
  const tierLabel = formatTier(owner.tier);
  const countLabel = itemCount === 1 ? "1 item" : `${itemCount} items`;
  const viewingSelf = !viewState.owned.selectedUsername || viewState.owned.selectedUsername === owner.username;
  const subject = viewingSelf ? "your account" : owner.username;
  elements.ownedSummary.textContent = `Viewing ${subject} (${tierLabel}) — ${countLabel}.`;
}

function buildShareUrl(bucket, id, token = "") {
  const pageMap = {
    characters: "character.html",
    templates: "template.html",
    systems: "system.html",
  };
  const page = pageMap[bucket];
  if (!page) {
    return window.location.href;
  }
  const record = `${bucket}:${id}`;
  const url = new URL(page, window.location.href);
  url.searchParams.set("record", record);
  if (token) {
    url.searchParams.set("share", token);
  } else {
    url.searchParams.delete("share");
  }
  return url.toString();
}

async function copyShareLink(url) {
  try {
    if (navigator.clipboard && typeof navigator.clipboard.writeText === "function") {
      await navigator.clipboard.writeText(url);
      if (status) {
        status.show("Copied share link to clipboard", { type: "success", timeout: 1800 });
      }
      return true;
    }
  } catch (error) {
    console.warn("Clipboard write failed", error);
  }
  try {
    const textarea = document.createElement("textarea");
    textarea.value = url;
    textarea.setAttribute("readonly", "true");
    textarea.style.position = "fixed";
    textarea.style.left = "-9999px";
    document.body.appendChild(textarea);
    textarea.select();
    const successful = document.execCommand("copy");
    document.body.removeChild(textarea);
    if (successful && status) {
      status.show("Copied share link to clipboard", { type: "success", timeout: 1800 });
    }
    return successful;
  } catch (error) {
    console.warn("Fallback clipboard copy failed", error);
    if (status) {
      status.show("Unable to copy link", { type: "danger" });
    }
    return false;
  }
}

function ensureShareModalInstance() {
  if (shareState.modal || !elements.shareModal) {
    return shareState.modal;
  }
  if (window.bootstrap && typeof window.bootstrap.Modal === "function") {
    shareState.modal = window.bootstrap.Modal.getOrCreateInstance(elements.shareModal);
    elements.shareModal.addEventListener("hidden.bs.modal", resetShareModal);
    return shareState.modal;
  }
  return null;
}

function resetShareModal() {
  shareState.record = null;
  shareState.shares = [];
  shareState.link = null;
  shareState.loading = false;
  shareState.linkStatus = "";
  if (elements.shareAddForm) {
    elements.shareAddForm.reset();
  }
  renderShareModal();
}

function renderShareModal() {
  const record = shareState.record;
  const hasRecord = Boolean(record);
  if (elements.shareModalTitle) {
    if (hasRecord) {
      const typeLabel = OWNED_TYPE_LABELS[record.bucket] || "Content";
      const nameLabel = record.label || record.id;
      elements.shareModalTitle.textContent = `${typeLabel} • ${nameLabel}`;
    } else {
      elements.shareModalTitle.textContent = "Manage access";
    }
  }
  const hasLink = Boolean(shareState.link?.token && hasRecord);
  if (elements.shareLinkGroup) {
    elements.shareLinkGroup.hidden = !hasLink;
  }
  if (elements.shareLinkInput) {
    elements.shareLinkInput.value = hasLink
      ? buildShareUrl(record.bucket, record.id, shareState.link.token)
      : "";
  }
  if (elements.shareLinkCopy) {
    elements.shareLinkCopy.disabled = !hasLink;
  }
  if (elements.shareLinkDisable) {
    elements.shareLinkDisable.hidden = !hasLink;
    elements.shareLinkDisable.disabled = shareState.loading;
  }
  if (elements.shareLinkGenerate) {
    elements.shareLinkGenerate.disabled = !hasRecord || shareState.loading;
    elements.shareLinkGenerate.textContent = hasLink ? "Reset link" : "Create link";
  }
  if (elements.shareLinkStatus) {
    elements.shareLinkStatus.textContent = shareState.linkStatus || "";
  }
  const isLoading = shareState.loading;
  if (elements.shareAddForm) {
    Array.from(elements.shareAddForm.elements).forEach((el) => {
      if (typeof el.disabled === "boolean") {
        el.disabled = !hasRecord || isLoading;
      }
    });
  }
  if (elements.sharePermission) {
    elements.sharePermission.value = elements.sharePermission.value || "view";
  }
  if (!hasRecord) {
    if (elements.shareTable) {
      elements.shareTable.hidden = true;
    }
    if (elements.shareRows) {
      elements.shareRows.innerHTML = "";
    }
    if (elements.shareEmpty) {
      elements.shareEmpty.hidden = false;
      elements.shareEmpty.textContent = "Select an item to manage access.";
    }
    return;
  }
  if (isLoading) {
    if (elements.shareTable) {
      elements.shareTable.hidden = true;
    }
    if (elements.shareRows) {
      elements.shareRows.innerHTML = "";
    }
    if (elements.shareEmpty) {
      elements.shareEmpty.hidden = false;
      elements.shareEmpty.textContent = "Loading access…";
    }
    return;
  }
  const shareEntries = Array.isArray(shareState.shares) ? shareState.shares : [];
  if (elements.shareTable) {
    elements.shareTable.hidden = shareEntries.length === 0;
  }
  if (elements.shareEmpty) {
    elements.shareEmpty.hidden = shareEntries.length !== 0;
    if (shareEntries.length === 0) {
      elements.shareEmpty.textContent = "No one else has access.";
    }
  }
  if (elements.shareRows) {
    const fragment = document.createDocumentFragment();
    const contentType = contentTypeFromBucket(record.bucket);
    shareEntries.forEach((entry) => {
      const row = document.createElement("tr");
      const userCell = document.createElement("td");
      userCell.textContent = entry.username;
      const actionCell = document.createElement("td");
      actionCell.className = "text-end";

      const permissionSelect = document.createElement("select");
      permissionSelect.className = "form-select form-select-sm d-inline-flex w-auto";
      [
        { value: "view", label: "Can view" },
        { value: "edit", label: "Can edit" },
      ].forEach((option) => {
        const opt = document.createElement("option");
        opt.value = option.value;
        opt.textContent = option.label;
        permissionSelect.appendChild(opt);
      });
      permissionSelect.value = entry.permissions === "edit" ? "edit" : "view";

      const removeButton = document.createElement("button");
      removeButton.type = "button";
      removeButton.className = "btn btn-outline-danger btn-sm ms-2";
      removeButton.textContent = "Remove";

      permissionSelect.addEventListener("change", async () => {
        const selected = permissionSelect.value;
        permissionSelect.disabled = true;
        removeButton.disabled = true;
        try {
          await dataManager.shareWithUser({
            contentType,
            contentId: record.id,
            username: entry.username,
            permissions: selected,
          });
          if (status) {
            status.show(`Updated access for ${entry.username}.`, { type: "success", timeout: 1800 });
          }
          await refreshShareModal();
        } catch (error) {
          console.error("Failed to update share permissions", error);
          if (status) {
            status.show(error.message || "Unable to update permissions", { type: "danger" });
          }
          permissionSelect.disabled = false;
          removeButton.disabled = false;
        }
      });

      removeButton.addEventListener("click", async () => {
        const confirmed = window.confirm(`Remove access for ${entry.username}?`);
        if (!confirmed) {
          return;
        }
        permissionSelect.disabled = true;
        removeButton.disabled = true;
        try {
          await dataManager.revokeShare({
            contentType,
            contentId: record.id,
            username: entry.username,
          });
          if (status) {
            status.show(`Removed ${entry.username}.`, { type: "success", timeout: 1800 });
          }
          await refreshShareModal();
        } catch (error) {
          console.error("Failed to revoke share", error);
          if (status) {
            status.show(error.message || "Unable to revoke access", { type: "danger" });
          }
          permissionSelect.disabled = false;
          removeButton.disabled = false;
        }
      });

      actionCell.appendChild(permissionSelect);
      actionCell.appendChild(removeButton);

      row.appendChild(userCell);
      row.appendChild(actionCell);
      fragment.appendChild(row);
    });
    elements.shareRows.replaceChildren(fragment);
  }
}

async function refreshShareModal() {
  const modal = ensureShareModalInstance();
  if (!modal || !shareState.record) {
    return;
  }
  shareState.loading = true;
  renderShareModal();
  try {
    const contentType = contentTypeFromBucket(shareState.record.bucket);
    const result = await dataManager.listShares(contentType, shareState.record.id);
    shareState.shares = Array.isArray(result?.shares) ? result.shares : [];
    shareState.link = result?.link || null;
  } catch (error) {
    console.error("Failed to load share details", error);
    if (status) {
      status.show(error.message || "Unable to load access", { type: "danger" });
    }
    shareState.shares = [];
    shareState.link = null;
  } finally {
    shareState.loading = false;
    renderShareModal();
  }
}

function openShareModal(record) {
  const modal = ensureShareModalInstance();
  if (!modal || !record) {
    return;
  }
  shareState.record = record;
  shareState.shares = [];
  shareState.link = null;
  shareState.loading = true;
  renderShareModal();
  modal.show();
  void refreshShareModal();
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

function contentTypeFromBucket(bucket) {
  if (!bucket) {
    return "";
  }
  if (BUCKET_TO_CONTENT_TYPE[bucket]) {
    return BUCKET_TO_CONTENT_TYPE[bucket];
  }
  return bucket.endsWith("s") ? bucket.slice(0, -1) : bucket;
}

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

function renderOwnedItems(items, owner) {
  if (!elements.ownedBody) {
    return;
  }
  if (!Array.isArray(items) || !items.length) {
    showOwnedEmpty(viewState.owned.selectedUsername ? "No content for this user." : "No saved content yet.");
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

    const shareButton = document.createElement("button");
    shareButton.type = "button";
    shareButton.className = "btn btn-outline-primary btn-sm";
    shareButton.textContent = "Share";
    shareButton.addEventListener("click", () => {
      openShareModal({ ...item, owner });
    });

    shareCell.appendChild(shareButton);

    const ownerRow = document.createElement("div");
    ownerRow.className = "d-flex flex-wrap justify-content-end gap-2 align-items-center";
    const ownerSelect = document.createElement("select");
    ownerSelect.className = "form-select form-select-sm w-auto";
    ownerSelect.setAttribute("aria-label", `Change owner for ${item.label || item.id}`);
    const currentOwnerUsername = owner?.username || "";
    const currentOwnerTier = owner?.tier || "";
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
  const username = viewState.owned.selectedUsername || "";
  try {
    const payload = await dataManager.listOwnedContent({ username, refresh: shouldRefresh });
    const owner = payload?.owner || null;
    const items = Array.isArray(payload?.items) ? payload.items : [];
    viewState.owned.owner = owner;
    viewState.owned.items = items;
    viewState.owned.stale = false;
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
  if (viewState.activeTab === TAB_OWNED && isViewingCurrentUser()) {
    loadOwnedContent({ refresh: true });
  } else if (isViewingCurrentUser()) {
    viewState.owned.stale = true;
  }
}

if (elements.openLogin && auth) {
  elements.openLogin.addEventListener("click", () => auth.showLogin());
}

if (elements.shareLinkCopy) {
  elements.shareLinkCopy.addEventListener("click", () => {
    if (!shareState.record || !shareState.link?.token) {
      return;
    }
    const url = buildShareUrl(shareState.record.bucket, shareState.record.id, shareState.link.token);
    void copyShareLink(url);
  });
}

if (elements.shareLinkGenerate) {
  elements.shareLinkGenerate.addEventListener("click", async () => {
    if (!shareState.record) {
      return;
    }
    const contentType = contentTypeFromBucket(shareState.record.bucket);
    elements.shareLinkGenerate.disabled = true;
    if (elements.shareLinkDisable) {
      elements.shareLinkDisable.disabled = true;
    }
    shareState.linkStatus = "Generating link…";
    renderShareModal();
    try {
      await dataManager.createShareLink({ contentType, contentId: shareState.record.id });
      if (status) {
        status.show("Share link ready.", { type: "success", timeout: 1800 });
      }
    } catch (error) {
      console.error("Failed to generate share link", error);
      if (status) {
        status.show(error.message || "Unable to create link", { type: "danger" });
      }
      shareState.linkStatus = error?.message || "Unable to create link.";
    } finally {
      await refreshShareModal();
      shareState.linkStatus = "";
      renderShareModal();
    }
  });
}

if (elements.shareLinkDisable) {
  elements.shareLinkDisable.addEventListener("click", async () => {
    if (!shareState.record) {
      return;
    }
    const contentType = contentTypeFromBucket(shareState.record.bucket);
    elements.shareLinkDisable.disabled = true;
    if (elements.shareLinkGenerate) {
      elements.shareLinkGenerate.disabled = true;
    }
    shareState.linkStatus = "Disabling link…";
    renderShareModal();
    try {
      await dataManager.revokeShareLink({ contentType, contentId: shareState.record.id });
      if (status) {
        status.show("Share link disabled.", { type: "success", timeout: 1800 });
      }
    } catch (error) {
      console.error("Failed to disable share link", error);
      if (status) {
        status.show(error.message || "Unable to disable link", { type: "danger" });
      }
      shareState.linkStatus = error?.message || "Unable to disable link.";
    } finally {
      await refreshShareModal();
      shareState.linkStatus = "";
      renderShareModal();
    }
  });
}

if (elements.shareAddForm) {
  elements.shareAddForm.addEventListener("submit", async (event) => {
    event.preventDefault();
    if (!shareState.record) {
      return;
    }
    const username = (elements.shareUsername?.value || "").trim();
    const permissions = elements.sharePermission?.value || "view";
    if (!username) {
      if (status) {
        status.show("Enter a username to share with.", { type: "warning", timeout: 1800 });
      }
      return;
    }
    const contentType = contentTypeFromBucket(shareState.record.bucket);
    disableForm(elements.shareAddForm, true);
    try {
      await dataManager.shareWithUser({
        contentType,
        contentId: shareState.record.id,
        username,
        permissions,
      });
      elements.shareAddForm.reset();
      if (elements.sharePermission) {
        elements.sharePermission.value = "view";
      }
      if (status) {
        status.show(`Shared with ${username}.`, { type: "success", timeout: 1800 });
      }
    } catch (error) {
      console.error("Failed to share with user", error);
      if (status) {
        status.show(error.message || "Unable to share", { type: "danger" });
      }
    } finally {
      disableForm(elements.shareAddForm, false);
      await refreshShareModal();
    }
  });
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
  const user = currentUser();
  if (user) {
    showPanel();
    updateTabAvailability();
    populateSettings({ force: true });
    if (isAdminSession()) {
      void loadUsers({ showSpinner: false, force: true });
    }
    populateOwnedUserFilter();
    viewState.owned.selectedUsername = "";
    viewState.owned.stale = true;
    loadOwnedContent({ refresh: true });
    setActiveTab(resolveTabFromHash(), { updateHash: false, force: true });
  } else {
    showGate();
    updateTabAvailability();
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

window.addEventListener("workbench:auth-changed", () => {
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

if (Array.isArray(elements.userSortHeaders)) {
  elements.userSortHeaders.forEach((header) => {
    if (!header) {
      return;
    }
    header.addEventListener("click", () => {
      const key = header.getAttribute("data-admin-users-sort");
      setUsersSort(key);
    });
    header.addEventListener("keydown", (event) => {
      if (event.key === "Enter" || event.key === " ") {
        event.preventDefault();
        const key = header.getAttribute("data-admin-users-sort");
        setUsersSort(key);
      }
    });
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

updateUserSortIndicators();
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

window.addEventListener("workbench:content-saved", handleOwnedContentEvent);
window.addEventListener("workbench:content-deleted", handleOwnedContentEvent);

renderShareModal();
handleAuthChanged();
