import { DataManager } from "./data-manager.js";
import { resolveApiBase } from "./api.js";

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

function disableForm(form, disabled) {
  const elements = form ? Array.from(form.elements) : [];
  elements.forEach((el) => {
    if (typeof el.disabled !== "undefined") {
      el.disabled = disabled;
    }
  });
}

function formatTierLabel(tier) {
  if (!tier) return "";
  const value = String(tier);
  return value.charAt(0).toUpperCase() + value.slice(1);
}

export function initAuthControls({
  root = document,
  status = null,
  dataManager = null,
  settingsHref = "admin.html",
  adminHref = null,
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
  const resolvedSettingsHref = settingsHref ? String(settingsHref) : "";
  const resolvedAdminHref = adminHref
    ? String(adminHref)
    : resolvedSettingsHref
      ? `${resolvedSettingsHref}#users`
      : "";

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

  function renderUserMenu(user) {
    if (!container) return;
    container.innerHTML = "";
    const dropdown = document.createElement("div");
    dropdown.className = "dropdown";
    dropdown.innerHTML = `
      <button
        class="btn btn-outline-secondary dropdown-toggle"
        type="button"
        data-bs-toggle="dropdown"
        aria-expanded="false"
        data-auth-menu-toggle
      >
        ${user.username}
      </button>
      <ul class="dropdown-menu dropdown-menu-end">
        <li><span class="dropdown-item-text text-body-secondary">Tier: ${formatTierLabel(user.tier)}</span></li>
        ${resolvedSettingsHref ? `<li><a class="dropdown-item" href="${resolvedSettingsHref}" data-auth-settings>Account settings</a></li>` : ""}
        ${
          user.tier === "admin" && resolvedAdminHref
            ? `<li><a class="dropdown-item" href="${resolvedAdminHref}" data-auth-admin>Admin controls</a></li>`
            : ""
        }
        <li><hr class="dropdown-divider" /></li>
        <li><button class="dropdown-item" type="button" data-auth-logout>Log out</button></li>
      </ul>
    `;
    container.appendChild(dropdown);
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
    if (toggle && window.bootstrap && typeof window.bootstrap.Dropdown === "function") {
      const instance = window.bootstrap.Dropdown.getOrCreateInstance(toggle);
      const showMenu = () => instance.show();
      const hideMenu = () => instance.hide();
      dropdown.addEventListener("mouseenter", showMenu);
      dropdown.addEventListener("mouseleave", hideMenu);
      toggle.addEventListener("focus", showMenu);
      dropdown.addEventListener("focusout", (event) => {
        if (!dropdown.contains(event.relatedTarget)) {
          hideMenu();
        }
      });
    }
  }

  function updateAuthDisplay() {
    if (!container) {
      return;
    }
    const user = sessionUser();
    if (user && manager.isAuthenticated()) {
      renderUserMenu(user);
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

  return {
    dataManager: manager,
    showLogin: () => openModal("login"),
    showRegister: () => openModal("register"),
    refreshDisplay: updateAuthDisplay,
  };
}
