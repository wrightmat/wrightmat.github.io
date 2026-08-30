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
// — definitions: [{key, label, type, helpTopic, default, options, getValue,
// setValue}], or a `() => [...]` thunk returning the same (see below).
// `type` is `"boolean"` (default, a switch) or `"select"` (a `<select>`,
// needs `options: [{value, label}]`). `helpTopic` is an entry id in
// common/data/help-topics.json, rendered as the same data-help-topic
// trigger span every other explanatory bit of UI in this suite uses — not
// inline paragraph text — right after the label; omit it for a setting
// that's genuinely self-explanatory from its label alone.
//
// A definition's value is normally read/written through this module's own
// flat, per-tool localStorage+server-sync store (keyed by `key`) — fine for
// Repository's tool-wide switches, where one value covers the whole tool.
// Passing `getValue()`/`setValue(value)` on a definition opts that one
// setting OUT of that store entirely and defers to the caller's own
// persistence instead — this is what a *per-System* preference (Crucible's
// Combat Scaling/Creature Type fields, Vault's Budget Ceiling field) uses:
// each already has its own `dataManager.getLocal/saveLocal("<tool>-settings",
// systemId, {...})` record, so the value genuinely lives elsewhere, keyed by
// whichever System is currently active — this module just needs to render
// and persist through to it, not own the value itself.
//
// `definitions` may be a thunk instead of a plain array — evaluated fresh
// every time the modal opens/re-renders, so a caller whose options (or even
// whose set of keys) depend on live app state (e.g. "whichever array fields
// the active System currently defines") always sees a current list without
// this module needing to know anything about that state itself.
//
// Returns {get(key), subscribe(fn), openModal()} — `get` always reflects the
// current best-known value (for a plain, self-owned definition only — a
// getValue-backed one should be read via that same getValue, not `get`);
// server-synced values (if signed in) arrive asynchronously shortly after
// this returns and fire `subscribe` callbacks once reconciled, same as any
// other server round trip in this suite.
export function initToolSettings({
  toolId,
  dataManager,
  status,
  title = "Settings",
  definitions = [],
  mountButton,
} = {}) {
  const local = loadLocal(toolId);
  // Starts as a full copy of whatever's already persisted (not just the
  // keys named by `definitions`) — `definitions` can be a thunk producing a
  // different key set call to call (e.g. one active System at a time), so
  // seeding only from the current call's keys would silently drop any
  // other System's already-saved preference the next time this object gets
  // written back out (see setValue/persistLocalAndServer below).
  const values = { ...local };
  const resolveDefinitions = () => (typeof definitions === "function" ? definitions() : definitions || []);
  // A static array's keys are all known up front, so its defaults can be
  // applied immediately — this is what makes get(key) return a real,
  // usable value (e.g. Repository's own boolean switches) before the modal
  // has ever been opened. A thunk's key set can vary call to call (e.g.
  // Crucible's per-System keys), so there's nothing fixed to pre-seed;
  // those definitions fall back to their own `default` lazily instead, via
  // currentValueFor below — moot anyway for the getValue/setValue-backed
  // ones a thunk is normally used for, since those never consult `values`.
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

  // A def's own getValue/setValue (when given) fully own that setting's
  // value — this module's flat store is only ever consulted for a
  // definition that didn't opt out of it.
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
        // A visible multi-row listbox (matches this suite's own "Locked
        // Features"-style pickers elsewhere), not a dropdown that needs a
        // ctrl/cmd-click to discover — the value is always an array
        // (empty when nothing's checked, never undefined), so a
        // getValue/setValue-backed definition can distinguish "nothing
        // selected" from "never configured" on its own if it needs to.
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
    const icon = el("span", "iconify fs-5");
    icon.dataset.icon = "tabler:settings";
    icon.setAttribute("aria-hidden", "true");
    button.appendChild(icon);
    button.addEventListener("click", () => openModal());
    mountButton(button);
    // Instantiated directly here (not left for the caller's own later
    // boot-time refreshTooltips() sweep to pick up) — self-contained
    // regardless of whether this module's own init happens to run before
    // or after that sweep in a given tool's own init() ordering.
    initTooltip(button, { title, placement: "bottom" });
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
        resolveDefinitions().forEach((def) => {
          // getValue/setValue-backed definitions never went through this
          // module's own flat store in the first place (see setValue's own
          // comment) — nothing here to reconcile against.
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
