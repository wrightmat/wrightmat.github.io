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
};

const TIER_OPTIONS = [
  { value: "free", label: "Free" },
  { value: "player", label: "Player" },
  { value: "gm", label: "GM" },
  { value: "creator", label: "Creator" },
  { value: "admin", label: "Admin" },
];

function isAdminSession() {
  const session = dataManager.session;
  return Boolean(session && session.user && session.user.tier === "admin");
}

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
  row.innerHTML = `<td colspan="5" class="text-center py-4 text-body-secondary">${message}</td>`;
  elements.usersBody.replaceChildren(row);
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

    row.innerHTML = `
      <td class="fw-semibold">${user.username}</td>
      <td class="text-body-secondary">${user.email}</td>
      <td><span class="badge text-bg-light">${formatTier(user.tier)}</span></td>
      <td><span class="badge ${statusClass}">${statusLabel}</span></td>
      <td class="text-end" data-admin-tier></td>
    `;

    const tierCell = row.querySelector("[data-admin-tier]");
    if (tierCell) {
      const select = document.createElement("select");
      select.className = "form-select form-select-sm w-auto ms-auto";
      TIER_OPTIONS.forEach((option) => {
        const opt = document.createElement("option");
        opt.value = option.value;
        opt.textContent = option.label;
        select.appendChild(opt);
      });
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
          if (select.parentElement) {
            const badge = row.querySelector("td:nth-child(3) .badge");
            if (badge) {
              badge.textContent = formatTier(newTier);
            }
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
      tierCell.appendChild(select);
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

async function loadUsers() {
  if (!isAdminSession()) {
    showGate();
    return;
  }
  showPanel();
  setLoading();
  try {
    const payload = await dataManager.listUsers();
    const users = Array.isArray(payload?.users) ? payload.users : [];
    renderUsers(users);
  } catch (error) {
    if (status) {
      status.show(error.message || "Unable to load users", { type: "danger" });
    }
    setLoading("Unable to load users");
  }
}

if (elements.openLogin && auth) {
  elements.openLogin.addEventListener("click", () => auth.showLogin());
}

window.addEventListener("workbench:auth-changed", () => {
  if (isAdminSession()) {
    loadUsers();
  } else {
    showGate();
  }
});

if (isAdminSession()) {
  loadUsers();
} else {
  showGate();
}
