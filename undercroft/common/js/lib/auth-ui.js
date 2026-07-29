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

// Exported so the tool-side copies of this same function (Forge/Loom/
// Sanctum/Workbench's dice.js/character-view.js) can share one implementation
// instead of re-defining it — see common/docs/code-audit.md.
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
  const modal = window.bootstrap && typeof window.bootstrap.Modal === "function"
    ? window.bootstrap.Modal.getOrCreateInstance(modalElement)
    : null;
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
    if (modal) {
      modal.hide();
    }
  }

  function openModal(view = "login") {
    showView(view);
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
    button.className = "btn btn-outline-secondary";
    button.textContent = "Login / Register";
    button.addEventListener("click", () => openModal("login"));
    container.appendChild(button);
  }

  // One dropdown for everything "who/what context am I in" — a user has to
  // be signed in to be in a campaign anyway, so the campaign selector lives
  // inside the same menu as account/logout rather than as a second,
  // separately-toggled control next to it.
  function renderUserMenu(user, groups) {
    if (!container) return;
    container.innerHTML = "";
    const active = manager.getActiveGroup();
    const activeStillExists = Boolean(active && groups.some((group) => group.id === active.groupId));
    const dropdown = document.createElement("div");
    dropdown.className = "dropdown undercroft-auth-menu";
    const groupItems = groups
      .map((group) => {
        const isActive = activeStillExists && group.id === active.groupId;
        return `
          <li>
            <div class="d-flex align-items-center">
              <button class="dropdown-item flex-grow-1${isActive ? " active" : ""}" type="button" data-campaign-select="${escapeHtml(group.id)}">
                ${escapeHtml(group.name)}
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
    dropdown.innerHTML = `
      <button
        class="btn btn-outline-secondary dropdown-toggle d-inline-flex align-items-center gap-2 py-1"
        type="button"
        data-bs-toggle="dropdown"
        aria-expanded="false"
        data-auth-menu-toggle
      >
        <span class="d-flex flex-column align-items-start lh-sm">
          <span>Logged in: ${escapeHtml(user.username)}</span>
          ${activeStillExists ? `<span class="text-body-secondary" style="font-size: 0.7rem;">Campaign: ${escapeHtml(active.name)}</span>` : ""}
        </span>
      </button>
      <ul class="dropdown-menu dropdown-menu-end undercroft-auth-dropdown">
        <li><span class="dropdown-item-text text-body-secondary">Tier: ${escapeHtml(manager.describeTier(user.tier) || user.tier || "")}</span></li>
        <li><hr class="dropdown-divider" /></li>
        ${
          groups.length
            ? groupItems
            : `<li><span class="dropdown-item-text text-body-secondary">No campaign groups yet</span></li>`
        }
        <li><hr class="dropdown-divider" /></li>
        <li><a class="dropdown-item" href="${resolvedAccountHref}" data-auth-settings>Account Settings</a></li>
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

  async function refreshUserMenu(user) {
    let groups = [];
    try {
      const result = await manager.listGroups();
      groups = Array.isArray(result?.groups) ? result.groups : [];
    } catch (error) {
      console.warn("Unable to load campaign groups", error);
    }
    if (sessionUser()?.username === user.username) {
      renderUserMenu(user, groups);
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
        showView("verify");
        if (modal) {
          modal.show();
        }
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

  // Keep the header in sync if something else on the page changes the
  // active campaign (e.g. a "Share with [active campaign]" flow elsewhere)
  // rather than only reacting to this control's own click handlers.
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
