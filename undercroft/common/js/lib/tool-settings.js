// Generic per-tool settings: a floating gear button + modal, backed by the
// same local-first + server-sync pattern every other per-user setting in
// this suite already uses (localStorage always, dataManager.saveUserSettings
// — a merge-patch endpoint — when authenticated; see dashboard.js's own
// persistSetting/loadLocalSetting for the pattern this mirrors). One shared
// implementation so a tool wanting a settings panel calls this instead of
// building its own modal/storage from scratch — Repository is the first
// caller, not the only intended one.
//
// The module owns *behavior* (state, persistence, the modal itself) but not
// *placement* — it hands the caller a plain button element via
// `mountButton` and lets that tool's own HTML/CSS decide where it lives
// (Repository puts it as a sticky-to-the-bottom fixture in its left pane;
// another tool's layout might want a different spot entirely).
import { el } from "./dom.js";
import { initHelpSystem } from "./help.js";

const LOCAL_PREFIX = "undercroft.toolSettings.";
const MODAL_ID = "undercroft-tool-settings-modal";

function loadLocal(toolId) {
  try {
    const raw = localStorage.getItem(`${LOCAL_PREFIX}${toolId}`);
    return raw ? JSON.parse(raw) : {};
  } catch (error) {
    return {};
  }
}

function saveLocal(toolId, values) {
  try {
    localStorage.setItem(`${LOCAL_PREFIX}${toolId}`, JSON.stringify(values));
  } catch (error) {
    // Local storage unavailable (private browsing, quota) — the server sync
    // below (when signed in) still gives this a home, same graceful-degrade
    // as every other local-setting writer in the suite.
  }
}

function ensureModal() {
  let modal = document.getElementById(MODAL_ID);
  if (modal) return modal;
  const wrapper = document.createElement("div");
  wrapper.innerHTML = `
    <div class="modal fade" id="${MODAL_ID}" tabindex="-1" aria-hidden="true">
      <div class="modal-dialog modal-dialog-centered">
        <div class="modal-content">
          <div class="modal-header">
            <h1 class="modal-title fs-5" data-tool-settings-title>Settings</h1>
            <button type="button" class="btn-close" data-bs-dismiss="modal" aria-label="Close"></button>
          </div>
          <div class="modal-body d-flex flex-column gap-3" data-tool-settings-body></div>
          <div class="modal-footer">
            <button type="button" class="btn btn-secondary" data-bs-dismiss="modal">Close</button>
          </div>
        </div>
      </div>
    </div>
  `;
  const element = wrapper.firstElementChild;
  document.body.appendChild(element);
  return element;
}

// initToolSettings({toolId, dataManager, status, title, definitions, mountButton})
// — definitions: [{key, label, helpTopic, default}] (boolean switches only
// for now; the modal/storage shape doesn't preclude adding other control
// types later, just nothing else has needed one yet). `helpTopic` is an
// entry id in common/data/help-topics.json, rendered as the same
// data-help-topic trigger span every other explanatory bit of UI in this
// suite uses — not inline paragraph text — right after the label; omit it
// for a setting that's genuinely self-explanatory from its label alone.
// Returns {get(key), subscribe(fn), openModal()} — `get` always reflects the
// current best-known value; server-synced values (if signed in) arrive
// asynchronously shortly after this returns and fire `subscribe` callbacks
// once reconciled, same as any other server round trip in this suite.
export function initToolSettings({
  toolId,
  dataManager,
  status,
  title = "Settings",
  definitions = [],
  mountButton,
} = {}) {
  const values = {};
  const local = loadLocal(toolId);
  definitions.forEach((def) => {
    values[def.key] = local[def.key] !== undefined ? local[def.key] : def.default;
  });

  const listeners = new Set();
  const notify = () => listeners.forEach((fn) => fn({ ...values }));

  function persistLocalAndServer() {
    saveLocal(toolId, values);
    if (dataManager?.isAuthenticated?.()) {
      dataManager.saveUserSettings({ [`${toolId}Settings`]: values }).catch((error) => {
        status?.show(error.message || "Unable to sync settings.", { type: "error" });
      });
    }
  }

  function setValue(key, value) {
    values[key] = value;
    persistLocalAndServer();
    notify();
  }

  const modal = ensureModal();
  const titleEl = modal.querySelector("[data-tool-settings-title]");
  const bodyEl = modal.querySelector("[data-tool-settings-body]");

  function renderModalBody() {
    if (!bodyEl) return;
    bodyEl.innerHTML = "";
    if (titleEl) titleEl.textContent = title;
    definitions.forEach((def) => {
      const row = el("div", "form-check form-switch d-flex align-items-center gap-2");
      const input = document.createElement("input");
      input.type = "checkbox";
      input.className = "form-check-input flex-shrink-0";
      input.setAttribute("role", "switch");
      input.id = `tool-setting-${toolId}-${def.key}`;
      input.checked = Boolean(values[def.key]);
      input.addEventListener("change", () => setValue(def.key, input.checked));
      const label = document.createElement("label");
      label.className = "form-check-label";
      label.htmlFor = input.id;
      label.textContent = def.label;
      row.append(input, label);
      if (def.helpTopic) {
        const helpTrigger = el("span", "align-middle");
        helpTrigger.dataset.helpTopic = def.helpTopic;
        helpTrigger.dataset.helpInsert = "replace";
        row.appendChild(helpTrigger);
      }
      bodyEl.appendChild(row);
    });
    // The spans above just got inserted — initHelpSystem's own boot-time
    // scan (called once, at page load) never saw them, so it has to run
    // again scoped to this freshly-built content each time the modal opens.
    void initHelpSystem({ root: bodyEl });
  }

  function openModal() {
    renderModalBody();
    const bsModal =
      window.bootstrap && typeof window.bootstrap.Modal === "function"
        ? window.bootstrap.Modal.getOrCreateInstance(modal)
        : null;
    bsModal?.show();
  }

  if (typeof mountButton === "function") {
    // Same sizing/shape as the other icon-only utility buttons every tool
    // header already has (pane toggles, theme toggle) — no `btn-sm` — since
    // that's the header/toolbar convention this button is meant to sit
    // alongside in practice, not a smaller one-off.
    const button = el("button", "btn btn-outline-secondary d-flex align-items-center justify-content-center");
    button.type = "button";
    button.setAttribute("aria-label", title);
    button.dataset.bsToggle = "tooltip";
    button.dataset.bsPlacement = "bottom";
    button.dataset.bsTitle = title;
    const icon = el("span", "iconify fs-5");
    icon.dataset.icon = "tabler:settings";
    icon.setAttribute("aria-hidden", "true");
    button.appendChild(icon);
    button.addEventListener("click", () => openModal());
    mountButton(button);
  }

  // Fire-and-forget reconciliation against server-synced values (a
  // different device/browser may have changed a setting) — local storage
  // and the button/modal above already work fine before this resolves, this
  // just corrects `values` (and re-renders the modal if it happens to be
  // open) once the round trip completes.
  if (dataManager?.isAuthenticated?.()) {
    dataManager
      .getUserSettings()
      .then((serverSettings) => {
        const serverValues = serverSettings?.[`${toolId}Settings`];
        if (!serverValues || typeof serverValues !== "object") return;
        let changed = false;
        definitions.forEach((def) => {
          if (serverValues[def.key] !== undefined && serverValues[def.key] !== values[def.key]) {
            values[def.key] = serverValues[def.key];
            changed = true;
          }
        });
        if (changed) {
          saveLocal(toolId, values);
          if (modal.classList.contains("show")) renderModalBody();
          notify();
        }
      })
      .catch(() => {
        // No server settings yet, or the fetch failed — local values (already
        // in effect) are a perfectly fine starting point either way.
      });
  }

  return {
    get: (key) => values[key],
    subscribe: (fn) => {
      listeners.add(fn);
      return () => listeners.delete(fn);
    },
    openModal,
  };
}
