import { DataManager } from "./data-manager.js";
import { resolveApiBase } from "./api.js";
import { resolveAccountHref, resolveToolContextPath } from "./app-shell.js";
import { disableForm, attachHoverDropdown } from "./dom.js";

const MODAL_ID = "undercroft-auth-modal";
const AUTH_CHANGED_EVENT = "undercroft:auth-changed";
const OPEN_LOGIN_EVENT = "undercroft:open-login";
const VIEW_TITLES = {
  login: "Sign in",
  register: "Create account",
  verify: "Verify email",
};

function ensureModal() {
  let modal = document.getElementById(MODAL_ID);
  if (modal) {
    return modal;
  }
  const wrapper = document.createElement("div");
  wrapper.innerHTML = `
    <div class="modal fade" id="${MODAL_ID}" tabindex="-1" aria-hidden="true">
      <div class="modal-dialog modal-dialog-centered">
        <div class="modal-content">
          <div class="modal-header">
            <h1 class="modal-title fs-5" data-auth-title>Sign in</h1>
            <button type="button" class="btn-close" data-bs-dismiss="modal" aria-label="Close"></button>
          </div>
          <div class="modal-body">
            <div data-auth-view="login">
              <form class="d-flex flex-column gap-3" data-auth-login-form>
                <div>
                  <label class="form-label" for="auth-login-identifier">Username or email</label>
                  <input class="form-control" id="auth-login-identifier" name="identifier" autocomplete="username" required />
                </div>
                <div>
                  <label class="form-label" for="auth-login-password">Password</label>
                  <input class="form-control" id="auth-login-password" type="password" name="password" autocomplete="current-password" required />
                </div>
                <div class="text-danger small min-h-1" data-auth-error></div>
                <div class="d-flex justify-content-between align-items-center flex-wrap gap-2">
                  <button type="button" class="btn btn-link" data-auth-switch="register">Need an account?</button>
                  <button type="submit" class="btn btn-primary">Log in</button>
                </div>
              </form>
            </div>
            <div data-auth-view="register" class="d-none">
              <form class="d-flex flex-column gap-3" data-auth-register-form>
                <div>
                  <label class="form-label" for="auth-register-email">Email</label>
                  <input class="form-control" id="auth-register-email" type="email" name="email" autocomplete="email" required />
                </div>
                <div>
                  <label class="form-label" for="auth-register-username">Username</label>
                  <input class="form-control" id="auth-register-username" name="username" autocomplete="username" required />
                </div>
                <div class="row g-3">
                  <div class="col-12">
                    <label class="form-label" for="auth-register-password">Password</label>
                    <input class="form-control" id="auth-register-password" type="password" name="password" autocomplete="new-password" required />
                  </div>
                  <div class="col-12">
                    <label class="form-label" for="auth-register-confirm">Confirm password</label>
                    <input class="form-control" id="auth-register-confirm" type="password" name="confirm" autocomplete="new-password" required />
                  </div>
                </div>
                <div class="text-danger small min-h-1" data-auth-error></div>
                <div class="d-flex justify-content-between align-items-center flex-wrap gap-2">
                  <button type="button" class="btn btn-link" data-auth-switch="login">Already registered?</button>
                  <button type="submit" class="btn btn-primary">Create account</button>
                </div>
              </form>
            </div>
            <div data-auth-view="verify" class="d-none">
              <form class="d-flex flex-column gap-3" data-auth-verify-form>
                <p class="mb-0 text-body-secondary small" data-auth-verify-message>
                  Enter the verification code sent to your email.
                </p>
                <div>
                  <label class="form-label" for="auth-verify-code">Verification code</label>
                  <input class="form-control" id="auth-verify-code" name="code" inputmode="numeric" pattern="\\d{4,8}" autocomplete="one-time-code" required />
                </div>
                <div class="text-danger small min-h-1" data-auth-error></div>
                <div class="d-flex justify-content-between align-items-center flex-wrap gap-2">
                  <button type="button" class="btn btn-link" data-auth-switch="register">Back</button>
                  <button type="submit" class="btn btn-primary">Verify & sign in</button>
                </div>
              </form>
            </div>
          </div>
        </div>
      </div>
    </div>
  `;
  const element = wrapper.firstElementChild;
  document.body.appendChild(element);
  modal = document.getElementById(MODAL_ID);
  return modal;
}

function clearError(element) {
  if (element) {
    element.textContent = "";
  }
}

function setError(element, message) {
  if (element) {
    element.textContent = message || "";
  }
}

// Exported so other tools (Forge/Loom/Sanctum/Workbench) share one
// implementation instead of re-defining it.
export function escapeHtml(value) {
  return String(value ?? "").replace(/[&<>"']/g, (ch) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[ch]));
}

export function initAuthControls({
  root = document,
  status = null,
  dataManager = null,
} = {}) {
  const manager = dataManager || new DataManager({ baseUrl: resolveApiBase() });
  const container = root.querySelector("[data-auth-control]");
  const modalElement = ensureModal();
  // Resolved fresh on every call, not cached — initAuthControls runs before
  // Bootstrap's deferred CDN <script> necessarily finishes, so caching a
  // one-time result risks permanently capturing `null` on a cold load. Same
  // fix dom.js's attachHoverDropdown uses for the identical race.
  function getModal() {
    return window.bootstrap && typeof window.bootstrap.Modal === "function"
      ? window.bootstrap.Modal.getOrCreateInstance(modalElement)
      : null;
  }
  const title = modalElement.querySelector("[data-auth-title]");
  const views = Array.from(modalElement.querySelectorAll("[data-auth-view]"));
  const loginForm = modalElement.querySelector("[data-auth-login-form]");
  const registerForm = modalElement.querySelector("[data-auth-register-form]");
  const verifyForm = modalElement.querySelector("[data-auth-verify-form]");
  const verifyMessage = modalElement.querySelector("[data-auth-verify-message]");
  const errors = {
    login: loginForm.querySelector("[data-auth-error]"),
    register: registerForm.querySelector("[data-auth-error]"),
    verify: verifyForm.querySelector("[data-auth-error]"),
  };

  const state = {
    pendingVerification: null,
  };
  const resolvedAccountHref = resolveAccountHref(resolveToolContextPath());

  function showView(name) {
    views.forEach((view) => {
      view.classList.toggle("d-none", view.dataset.authView !== name);
    });
    if (title && VIEW_TITLES[name]) {
      title.textContent = VIEW_TITLES[name];
    }
    Object.keys(errors).forEach((key) => clearError(errors[key]));
  }

  function closeModal() {
    const modal = getModal();
    if (modal) {
      modal.hide();
    }
  }

  function openModal(view = "login") {
    showView(view);
    const modal = getModal();
    if (modal) {
      modal.show();
    }
  }

  function sessionUser() {
    return manager.session ? manager.session.user : null;
  }

  function notifyAuthChange() {
    const detail = { session: manager.session || null };
    window.dispatchEvent(new CustomEvent(AUTH_CHANGED_EVENT, { detail }));
  }

  function handleSession(result, message) {
    if (result && result.token && result.user) {
      if (status) {
        status.show(message || `Welcome, ${result.user.username}!`, { type: "success", timeout: 2500 });
      }
      state.pendingVerification = null;
      updateAuthDisplay();
      closeModal();
      notifyAuthChange();
    }
  }

  function renderLoginButton() {
    if (!container) return;
    container.innerHTML = "";
    const button = document.createElement("button");
    button.type = "button";
    button.className = "btn btn-outline-secondary d-inline-flex align-items-center gap-2 undercroft-auth-trigger";
    button.setAttribute("aria-label", "Login / Register");
    const icon = document.createElement("span");
    icon.className = "iconify fs-5";
    icon.dataset.icon = "tabler:login";
    icon.setAttribute("aria-hidden", "true");
    const label = document.createElement("span");
    label.className = "undercroft-auth-login-label";
    label.textContent = "Login / Register";
    button.append(icon, label);
    button.addEventListener("click", () => openModal("login"));
    container.appendChild(button);
  }

  // Resolves each distinct system_id/setting_id across `groups` to its real
  // title once (deduped), for the small-print line under a campaign's name.
  // Best-effort per id: a deleted/inaccessible record falls back to its
  // own raw id, the same convention used suite-wide.
  async function resolveTitles(bucket, ids) {
    const map = new Map();
    await Promise.all(
      Array.from(ids).map(async (id) => {
        try {
          const result = await manager.get(bucket, id);
          map.set(id, result?.payload?.title || result?.payload?.name || id);
        } catch (error) {
          map.set(id, id);
        }
      })
    );
    return map;
  }

  async function resolveGroupContextLabels(groups) {
    const systemIds = new Set();
    const settingIds = new Set();
    groups.forEach((group) => {
      if (group.system_id) systemIds.add(group.system_id);
      if (group.setting_id) settingIds.add(group.setting_id);
    });
    const [systemTitles, settingTitles] = await Promise.all([
      resolveTitles("system", systemIds),
      resolveTitles("setting", settingIds),
    ]);
    return { systemTitles, settingTitles };
  }

  // One dropdown for "who/what context am I in" — the campaign selector
  // lives inside the account menu rather than a second, separate control.
  function renderUserMenu(user, groups, contextLabels = { systemTitles: new Map(), settingTitles: new Map() }) {
    if (!container) return;
    container.innerHTML = "";
    const active = manager.getActiveGroup();
    const activeStillExists = Boolean(active && groups.some((group) => group.id === active.groupId));
    const dropdown = document.createElement("div");
    dropdown.className = "dropdown undercroft-auth-menu";
    const groupItems = groups
      .map((group) => {
        const isActive = activeStillExists && group.id === active.groupId;
        // list_groups' scope=member query returns both owned groups and
        // ones this user is only a member of — owner_id tells them apart.
        const isOwner = group.owner_id === user.id;
        // System first, Setting second, matching _serialize_group's field
        // order elsewhere. Neither assigned means no sub-line, not an empty one.
        const contextParts = [
          group.system_id ? contextLabels.systemTitles.get(group.system_id) || group.system_id : "",
          group.setting_id ? contextLabels.settingTitles.get(group.setting_id) || group.setting_id : "",
        ].filter(Boolean);
        const contextLine = contextParts.length
          ? `<div class="text-body-secondary" style="font-size: 0.7rem;">${escapeHtml(contextParts.join(" · "))}</div>`
          : "";
        return `
          <li>
            <div class="d-flex align-items-center">
              <button class="dropdown-item flex-grow-1${isActive ? " active" : ""}" type="button" data-campaign-select="${escapeHtml(group.id)}">
                <div class="d-flex flex-column align-items-start lh-sm">
                  <span class="d-inline-flex align-items-center gap-1">
                    ${escapeHtml(group.name)}
                    ${
                      isOwner
                        ? `<span class="badge text-bg-secondary" style="font-size: 0.6rem;" title="You own this group">Owner</span>`
                        : ""
                    }
                  </span>
                  ${contextLine}
                </div>
              </button>
              ${
                isActive
                  ? `<button class="btn btn-sm btn-link text-body-secondary px-2" type="button" data-campaign-clear aria-label="Leave ${escapeHtml(group.name)}">&times;</button>`
                  : ""
              }
            </div>
          </li>
        `;
      })
      .join("");
    const tierLabel = manager.describeTier(user.tier) || user.tier || "";
    const identityLine = `${escapeHtml(user.username)} (${escapeHtml(tierLabel)})`;
    dropdown.innerHTML = `
      <button
        class="btn btn-outline-secondary dropdown-toggle d-inline-flex align-items-center gap-2 undercroft-auth-trigger"
        type="button"
        data-bs-toggle="dropdown"
        aria-expanded="false"
        data-auth-menu-toggle
        aria-label="Account menu — logged in as ${escapeHtml(user.username)}"
      >
        <span class="iconify fs-5" data-icon="tabler:user-circle" aria-hidden="true"></span>
        <span class="undercroft-auth-text flex-column align-items-start" style="width: 10rem;">
          <span class="undercroft-auth-username text-truncate w-100">${identityLine}</span>
          ${activeStillExists ? `<span class="undercroft-auth-campaign text-body-secondary text-truncate w-100">${escapeHtml(active.name)}</span>` : ""}
        </span>
      </button>
      <ul class="dropdown-menu dropdown-menu-end undercroft-auth-dropdown">
        <li><span class="dropdown-item-text text-body-secondary">${identityLine}</span></li>
        <li><a class="dropdown-item" href="${resolvedAccountHref}" data-auth-settings>Account Settings</a></li>
        <li><hr class="dropdown-divider" /></li>
        ${
          groups.length
            ? groupItems
            : `<li><span class="dropdown-item-text text-body-secondary">No campaign groups yet</span></li>`
        }
        <li><hr class="dropdown-divider" /></li>
        <li><button class="dropdown-item" type="button" data-auth-logout>Log out</button></li>
      </ul>
    `;
    container.appendChild(dropdown);

    dropdown.querySelectorAll("[data-campaign-select]").forEach((button) => {
      button.addEventListener("click", () => {
        const groupId = button.getAttribute("data-campaign-select");
        const group = groups.find((entry) => entry.id === groupId);
        manager.setActiveGroup(groupId, group ? group.name : "");
        renderUserMenu(user, groups);
      });
    });
    dropdown.querySelectorAll("[data-campaign-clear]").forEach((button) => {
      button.addEventListener("click", (event) => {
        event.stopPropagation();
        manager.setActiveGroup(null);
        renderUserMenu(user, groups);
      });
    });
    const logoutBtn = dropdown.querySelector("[data-auth-logout]");
    if (logoutBtn) {
      logoutBtn.addEventListener("click", async () => {
        try {
          await manager.logout();
          if (status) {
            status.show("Signed out", { type: "info", timeout: 2000 });
          }
        } catch (error) {
          if (status) {
            status.show(error.message || "Unable to sign out", { type: "danger" });
          }
        } finally {
          updateAuthDisplay();
          notifyAuthChange();
        }
      });
    }
    const toggle = dropdown.querySelector("[data-auth-menu-toggle]");
    if (toggle) {
      attachHoverDropdown(dropdown, toggle);
    }
  }

  // getActiveGroup() returns whatever was cached at selection time and
  // never re-checks the server, so a renamed/deleted group can go stale
  // indefinitely. This is the one place that fetches the live list, so it
  // catches the cache up: refresh a drifted name, or clear a dead groupId.
  function resyncActiveGroup(groups) {
    const active = manager.getActiveGroup();
    if (!active?.groupId) return;
    const live = groups.find((group) => group.id === active.groupId);
    if (!live) {
      manager.setActiveGroup(null);
    } else if (live.name !== active.name) {
      manager.setActiveGroup(active.groupId, live.name || "");
    }
  }

  async function refreshUserMenu(user) {
    let groups = [];
    try {
      // includeMemberGroups — this menu should offer campaigns you were
      // added to, not just ones you own. See data-manager.js's listGroups
      // comment for why this isn't the default.
      const result = await manager.listGroups({ includeMemberGroups: true });
      groups = Array.isArray(result?.groups) ? result.groups : [];
    } catch (error) {
      console.warn("Unable to load campaign groups", error);
    }
    resyncActiveGroup(groups);
    const contextLabels = await resolveGroupContextLabels(groups).catch(() => ({
      systemTitles: new Map(),
      settingTitles: new Map(),
    }));
    if (sessionUser()?.username === user.username) {
      renderUserMenu(user, groups, contextLabels);
    }
  }

  function updateAuthDisplay() {
    if (!container) {
      return;
    }
    const user = sessionUser();
    if (user && manager.isAuthenticated()) {
      renderUserMenu(user, []);
      void refreshUserMenu(user);
    } else {
      renderLoginButton();
    }
  }

  updateAuthDisplay();
  notifyAuthChange();

  loginForm.addEventListener("submit", async (event) => {
    event.preventDefault();
    clearError(errors.login);
    const formData = new FormData(loginForm);
    const identifier = String(formData.get("identifier") || "").trim();
    const password = String(formData.get("password") || "");
    disableForm(loginForm, true);
    try {
      const result = await manager.login({ username_or_email: identifier, password });
      handleSession(result, `Welcome back, ${result.user.username}!`);
    } catch (error) {
      setError(errors.login, error.message || "Unable to log in");
    } finally {
      disableForm(loginForm, false);
    }
  });

  registerForm.addEventListener("submit", async (event) => {
    event.preventDefault();
    clearError(errors.register);
    const formData = new FormData(registerForm);
    const email = String(formData.get("email") || "").trim();
    const username = String(formData.get("username") || "").trim();
    const password = String(formData.get("password") || "");
    const confirm = String(formData.get("confirm") || "");
    if (password !== confirm) {
      setError(errors.register, "Passwords do not match");
      return;
    }
    disableForm(registerForm, true);
    try {
      const result = await manager.register({ email, username, password });
      if (result && result.token && result.user) {
        handleSession(result, `Account created for ${result.user.username}`);
        return;
      }
      if (result && result.requires_verification) {
        state.pendingVerification = { email, username };
        if (verifyMessage) {
          verifyMessage.textContent = `Enter the verification code sent to ${email}.`;
        }
        if (result.message && status) {
          status.show(result.message, { type: "info", timeout: 2500 });
        }
        // Reuses openModal (rather than a third inline copy) even though
        // the modal is already open mid-registration here.
        openModal("verify");
        return;
      }
      if (result && result.message) {
        if (status) {
          status.show(result.message, { type: "info", timeout: 2500 });
        }
      }
    } catch (error) {
      setError(errors.register, error.message || "Unable to register");
    } finally {
      disableForm(registerForm, false);
    }
  });

  verifyForm.addEventListener("submit", async (event) => {
    event.preventDefault();
    clearError(errors.verify);
    const formData = new FormData(verifyForm);
    const code = String(formData.get("code") || "").trim();
    const context = state.pendingVerification;
    if (!context) {
      setError(errors.verify, "No registration in progress");
      return;
    }
    disableForm(verifyForm, true);
    try {
      const payload = { code };
      if (context.email) {
        payload.email = context.email;
      }
      if (context.username) {
        payload.username = context.username;
      }
      const result = await manager.verifyRegistration(payload);
      handleSession(result, `Welcome, ${result.user.username}!`);
    } catch (error) {
      setError(errors.verify, error.message || "Verification failed");
    } finally {
      disableForm(verifyForm, false);
    }
  });

  modalElement.addEventListener("click", (event) => {
    const trigger = event.target.closest("[data-auth-switch]");
    if (!trigger) return;
    const target = trigger.getAttribute("data-auth-switch");
    if (target === "register") {
      showView("register");
    } else if (target === "login") {
      showView("login");
    }
  });

  window.addEventListener(OPEN_LOGIN_EVENT, () => {
    openModal("login");
  });

  // Keep the header in sync when something else changes the active
  // campaign (e.g. a "Share with [active campaign]" flow elsewhere).
  window.addEventListener("workbench:active-group-changed", () => {
    const user = sessionUser();
    if (user && manager.isAuthenticated()) {
      void refreshUserMenu(user);
    }
  });

  return {
    dataManager: manager,
    showLogin: () => openModal("login"),
    showRegister: () => openModal("register"),
    refreshDisplay: updateAuthDisplay,
  };
}
