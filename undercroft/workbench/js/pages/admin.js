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

const OWNED_TYPE_LABELS = {
  characters: "Character",
  templates: "Template",
  systems: "System",
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
  owned: {
    owner: null,
    items: [],
    selectedUsername: "",
    loading: false,
    stale: true,
  },
};

function isAdminSession() {
  const session = dataManager.session;
  return Boolean(session && session.user && session.user.tier === "admin");
}

function currentUser() {
  return dataManager.session?.user || null;
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
    return;
  }
  const currentUser = dataManager.session?.user;
  const fragment = document.createDocumentFragment();
  users.forEach((user) => {
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

async function loadUsers({ showSpinner = true } = {}) {
  if (!isAdminSession() || viewState.activeTab !== TAB_USERS) {
    return;
  }
  if (showSpinner) {
    setLoading();
  }
  try {
    const payload = await dataManager.listUsers();
    const users = Array.isArray(payload?.users) ? payload.users : [];
    viewState.users = users;
    renderUsers(users);
    populateOwnedUserFilter();
  } catch (error) {
    if (status) {
      status.show(error.message || "Unable to load users", { type: "danger" });
    }
    setLoading("Unable to load users");
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
  cell.colSpan = 5;
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

function buildShareUrl(bucket, id) {
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

function renderOwnedItems(items, owner) {
  if (!elements.ownedBody) {
    return;
  }
  if (!Array.isArray(items) || !items.length) {
    showOwnedEmpty(viewState.owned.selectedUsername ? "No content for this user." : "No saved content yet.");
    updateOwnedSummary(owner, 0);
    return;
  }
  if (elements.ownedTable) {
    elements.ownedTable.hidden = false;
  }
  if (elements.ownedEmpty) {
    elements.ownedEmpty.hidden = true;
  }
  const fragment = document.createDocumentFragment();
  items.forEach((item) => {
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

    const actionsCell = document.createElement("td");
    actionsCell.className = "text-end";
    const controls = document.createElement("div");
    controls.className = "d-flex flex-wrap justify-content-end gap-2 align-items-center";

    const toggleWrapper = document.createElement("div");
    toggleWrapper.className = "form-check form-switch mb-0";
    const toggle = document.createElement("input");
    toggle.className = "form-check-input";
    toggle.type = "checkbox";
    toggle.role = "switch";
    toggle.checked = Boolean(item.is_public);
    toggle.setAttribute("aria-label", `Toggle visibility for ${item.label || item.id}`);
    const toggleLabel = document.createElement("label");
    toggleLabel.className = "form-check-label";
    toggleLabel.textContent = toggle.checked ? "Public" : "Private";
    toggleWrapper.appendChild(toggle);
    toggleWrapper.appendChild(toggleLabel);

    toggle.addEventListener("change", async () => {
      const desired = toggle.checked;
      toggle.disabled = true;
      try {
        const result = await dataManager.toggleVisibility(item.bucket, item.id, desired);
        const isPublic = Boolean(result?.public);
        toggle.checked = isPublic;
        toggleLabel.textContent = isPublic ? "Public" : "Private";
        item.is_public = isPublic;
        if (status) {
          status.show(
            isPublic ? "Content is now shareable via link." : "Content visibility set to private.",
            { type: "success", timeout: 2000 },
          );
        }
      } catch (error) {
        console.error("Failed to toggle visibility", error);
        toggle.checked = !desired;
        if (status) {
          status.show(error.message || "Unable to update visibility", { type: "danger" });
        }
      } finally {
        toggle.disabled = false;
      }
    });

    const copyButton = document.createElement("button");
    copyButton.type = "button";
    copyButton.className = "btn btn-outline-secondary btn-sm";
    copyButton.textContent = "Copy link";
    const shareUrl = buildShareUrl(item.bucket, item.id);
    copyButton.addEventListener("click", () => {
      copyShareLink(shareUrl);
    });

    const openLink = document.createElement("a");
    openLink.href = shareUrl;
    openLink.target = "_blank";
    openLink.rel = "noopener";
    openLink.className = "btn btn-outline-primary btn-sm";
    openLink.textContent = "Open";

    controls.appendChild(toggleWrapper);
    controls.appendChild(copyButton);
    controls.appendChild(openLink);
    actionsCell.appendChild(controls);

    row.appendChild(nameCell);
    row.appendChild(typeCell);
    row.appendChild(createdCell);
    row.appendChild(accessedCell);
    row.appendChild(actionsCell);
    fragment.appendChild(row);
  });

  elements.ownedBody.replaceChildren(fragment);
  updateOwnedSummary(owner, items.length);
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
window.addEventListener("workbench:content-visibility", handleOwnedContentEvent);

handleAuthChanged();
