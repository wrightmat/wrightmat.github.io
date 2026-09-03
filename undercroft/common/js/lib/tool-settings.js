// Generic per-tool settings: a floating gear button + modal, backed by the
// same local-first + server-sync pattern every per-user setting in this
// suite uses (localStorage always, dataManager.saveUserSettings — a
// merge-patch endpoint — when authenticated; mirrors dashboard.js's own
// persistSetting/loadLocalSetting). One shared implementation so a tool
// calls this instead of building its own modal/storage — Repository is the
// first caller, not the only intended one.
//
// Owns *behavior* (state, persistence, the modal) but not *placement* — it
// hands the caller a plain button via `mountButton` and lets that tool's
// own HTML/CSS decide where it lives.
import { el } from "./dom.js";
import { initHelpSystem } from "./help.js";
import { initTooltip } from "./tooltips.js";

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
    // Local storage unavailable (private browsing, quota) — server sync
    // below still gives this a home when signed in.
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
// — definitions: [{key, label, type, helpTopic, default, options, getValue,
// setValue}], or a `() => [...]` thunk. `type` is `"boolean"` (default, a
// switch) or `"select"` (needs `options: [{value, label}]`). `helpTopic` is
// an id in help-topics.json, rendered as the standard data-help-topic
// trigger after the label; omit for a self-explanatory setting.
//
// A definition's value normally reads/writes through this module's own
// flat, per-tool localStorage+server-sync store — fine for a tool-wide
// switch. Passing `getValue()`/`setValue(value)` opts a setting OUT of that
// store and defers to the caller's own persistence — used by a *per-System*
// preference (Crucible's Combat Scaling field, Vault's Budget Ceiling) that
// already has its own `dataManager.getLocal/saveLocal` record keyed by the
// active System; this module just renders and persists through to it.
//
// `definitions` may be a thunk, evaluated fresh every modal open/re-render,
// for a caller whose options depend on live app state (e.g. the active
// System's own array fields).
//
// Returns {get(key), subscribe(fn), openModal()} — `get` reflects the
// current best-known value for a self-owned definition (a getValue-backed
// one should be read via that same getValue). Server-synced values arrive
// asynchronously and fire `subscribe` once reconciled.
export function initToolSettings({
  toolId,
  dataManager,
  status,
  title = "Settings",
  definitions = [],
  mountButton,
} = {}) {
  const local = loadLocal(toolId);
  // Full copy of whatever's already persisted, not just the current call's
  // keys — `definitions` can be a thunk producing a different key set call
  // to call, and seeding only from the current keys would drop another
  // System's already-saved preference on the next write-back.
  const values = { ...local };
  const resolveDefinitions = () => (typeof definitions === "function" ? definitions() : definitions || []);
  // A static array's keys are known up front, so defaults apply immediately
  // — get(key) returns a real value before the modal ever opens. A thunk's
  // key set varies call to call, so those fall back to `default` lazily via
  // currentValueFor instead.
  if (typeof definitions !== "function") {
    definitions.forEach((def) => {
      if (values[def.key] === undefined) values[def.key] = def.default;
    });
  }

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

  // A def's own getValue/setValue, when given, fully own that setting's value.
  function currentValueFor(def) {
    if (typeof def.getValue === "function") return def.getValue();
    return values[def.key] !== undefined ? values[def.key] : def.default;
  }

  function applyValueFor(def, value) {
    if (typeof def.setValue === "function") {
      def.setValue(value);
      notify();
    } else {
      setValue(def.key, value);
    }
  }

  const modal = ensureModal();
  const titleEl = modal.querySelector("[data-tool-settings-title]");
  const bodyEl = modal.querySelector("[data-tool-settings-body]");

  function renderModalBody() {
    if (!bodyEl) return;
    bodyEl.innerHTML = "";
    if (titleEl) titleEl.textContent = title;
    resolveDefinitions().forEach((def) => {
      let row;
      if (def.type === "select") {
        row = el("div", "d-flex flex-column gap-1");
        const label = document.createElement("label");
        label.className = "form-label fw-semibold mb-0 d-flex align-items-center gap-1";
        const select = document.createElement("select");
        select.className = "form-select";
        select.id = `tool-setting-${toolId}-${def.key}`;
        (def.options || []).forEach((option) => {
          const opt = document.createElement("option");
          opt.value = option.value;
          opt.textContent = option.label;
          select.appendChild(opt);
        });
        select.value = currentValueFor(def) ?? def.default ?? "";
        select.addEventListener("change", () => applyValueFor(def, select.value));
        label.htmlFor = select.id;
        label.textContent = def.label;
        row.append(label);
        if (def.helpTopic) {
          const helpTrigger = el("span", "align-middle");
          helpTrigger.dataset.helpTopic = def.helpTopic;
          helpTrigger.dataset.helpInsert = "replace";
          label.appendChild(helpTrigger);
        }
        row.appendChild(select);
      } else if (def.type === "multiselect") {
        // A visible multi-row listbox (matches this suite's "Locked
        // Features"-style pickers), not a dropdown needing a ctrl/cmd-click
        // to discover. Value is always an array, never undefined.
        row = el("div", "d-flex flex-column gap-1");
        const label = document.createElement("label");
        label.className = "form-label fw-semibold mb-0 d-flex align-items-center gap-1";
        const select = document.createElement("select");
        select.className = "form-select";
        select.multiple = true;
        select.size = Math.min(8, Math.max(3, (def.options || []).length || 3));
        select.id = `tool-setting-${toolId}-${def.key}`;
        (def.options || []).forEach((option) => {
          const opt = document.createElement("option");
          opt.value = option.value;
          opt.textContent = option.label;
          select.appendChild(opt);
        });
        const selectedValues = new Set(currentValueFor(def) || []);
        Array.from(select.options).forEach((opt) => {
          opt.selected = selectedValues.has(opt.value);
        });
        select.addEventListener("change", () => {
          applyValueFor(
            def,
            Array.from(select.selectedOptions).map((opt) => opt.value)
          );
        });
        label.htmlFor = select.id;
        label.textContent = def.label;
        row.append(label);
        if (def.helpTopic) {
          const helpTrigger = el("span", "align-middle");
          helpTrigger.dataset.helpTopic = def.helpTopic;
          helpTrigger.dataset.helpInsert = "replace";
          label.appendChild(helpTrigger);
        }
        row.appendChild(select);
      } else {
        row = el("div", "form-check form-switch d-flex align-items-center gap-2");
        const input = document.createElement("input");
        input.type = "checkbox";
        input.className = "form-check-input flex-shrink-0";
        input.setAttribute("role", "switch");
        input.id = `tool-setting-${toolId}-${def.key}`;
        input.checked = Boolean(currentValueFor(def));
        input.addEventListener("change", () => applyValueFor(def, input.checked));
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
      }
      bodyEl.appendChild(row);
    });
    // The spans above just got inserted — initHelpSystem's boot-time scan
    // never saw them, so it reruns scoped to this fresh content.
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
    // Same sizing/shape as other icon-only header utility buttons (pane
    // toggles, theme toggle) — no `btn-sm`.
    const button = el("button", "btn btn-outline-secondary d-flex align-items-center justify-content-center");
    button.type = "button";
    button.setAttribute("aria-label", title);
    const icon = el("span", "iconify fs-5");
    icon.dataset.icon = "tabler:settings";
    icon.setAttribute("aria-hidden", "true");
    button.appendChild(icon);
    button.addEventListener("click", () => openModal());
    mountButton(button);
    // Instantiated directly here, not left for the caller's later boot-time
    // refreshTooltips() sweep — self-contained regardless of init ordering.
    initTooltip(button, { title, placement: "bottom" });
  }

  // Fire-and-forget reconciliation against server-synced values (a
  // different device may have changed a setting) — corrects `values` and
  // re-renders the modal if open, once the round trip completes.
  if (dataManager?.isAuthenticated?.()) {
    dataManager
      .getUserSettings()
      .then((serverSettings) => {
        const serverValues = serverSettings?.[`${toolId}Settings`];
        if (!serverValues || typeof serverValues !== "object") return;
        let changed = false;
        resolveDefinitions().forEach((def) => {
          // getValue/setValue-backed definitions never went through this
          // module's flat store — nothing to reconcile against.
          if (typeof def.getValue === "function") return;
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
