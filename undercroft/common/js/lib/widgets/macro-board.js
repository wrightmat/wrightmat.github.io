// The Dashboard's own trigger surface for the Macro system (see
// common/data/kind/macro.json, macro-runner.js) — a small grid of buttons,
// one per saved macro, each firing runMacro() on click. Authoring happens
// in Loom (Library → macro) like any other kind; this widget only lists and
// runs what's already saved. `multiple: false` in the dashboard catalog —
// one board shows every macro, closer to Soundboard's "one widget, many
// clips" shape than Clock's "one instance per thing."
import { el } from "../dom.js";
import { fetchKindEntriesWithIds } from "../content-fetch.js";
import { runMacro } from "./macro-runner.js";
import { resolveWledDeviceByAlias } from "./wled.js";

function icon(name) {
  const span = el("span", "iconify fs-4");
  span.dataset.icon = name;
  span.setAttribute("aria-hidden", "true");
  return span;
}

export function initMacroBoardWidget(
  container,
  { dataManager, status, groupContext, wledDevices = [], onWledDevicesChange, setTitle, ensureWidget, isEditing } = {}
) {
  if (!container) {
    return { destroy() {} };
  }

  let destroyed = false;
  let macros = [];
  let deviceList = Array.isArray(wledDevices) ? wledDevices.slice() : [];
  const running = new Set();
  // Set while a macro is blocked on the GM picking a device for one or more
  // unrecognized WLED aliases (see wled.js's own alias field) — cleared once
  // resolved (or cancelled), then the macro is re-attempted from scratch so
  // the normal missing-alias check runs again against the now-updated list.
  let pendingAlias = null; // { macro, aliases: string[] }

  function persistDevices(next) {
    deviceList = next;
    if (typeof onWledDevicesChange === "function") onWledDevicesChange(deviceList.slice());
  }

  async function loadMacros() {
    if (!dataManager) {
      macros = [];
      if (!destroyed) render();
      return;
    }
    try {
      const entries = await fetchKindEntriesWithIds(dataManager, "macro");
      macros = entries
        .map(({ id, entity }) => ({ id, ...(entity && typeof entity === "object" ? entity : {}) }))
        .filter((macro) => Array.isArray(macro.actions));
    } catch (error) {
      macros = [];
      status?.show?.(error?.message || "Unable to load macros.", { type: "error", timeout: 3000 });
    }
    if (!destroyed) render();
  }

  // Every distinct WLED alias this macro references that doesn't currently
  // resolve against deviceList — checked up front, before running anything,
  // so a macro either runs cleanly or stops to ask, rather than partway
  // failing on whichever WLED action happens to come first.
  function findMissingWledAliases(macro) {
    const seen = new Set();
    const missing = [];
    (macro.actions || []).forEach((action) => {
      if (action?.type !== "wled") return;
      const target = String(action.target || "").trim();
      const key = target.toLowerCase();
      if (!target || seen.has(key)) return;
      seen.add(key);
      if (!resolveWledDeviceByAlias(deviceList, target)) missing.push(target);
    });
    return missing;
  }

  async function runMacroById(macro) {
    if (running.has(macro.id)) return;
    const missing = findMissingWledAliases(macro);
    if (missing.length) {
      pendingAlias = { macro, aliases: missing };
      render();
      return;
    }
    running.add(macro.id);
    render();
    try {
      await runMacro(macro, { dataManager, groupContext, status, wledDevices: deviceList, ensureWidget });
      status?.show?.(`Ran "${macro.name || macro.id}".`, { type: "success", timeout: 1800 });
    } finally {
      running.delete(macro.id);
      if (!destroyed) render();
    }
  }

  function renderAliasPrompt() {
    const { macro, aliases } = pendingAlias;
    const wrap = el("div", "d-flex flex-column gap-2 border rounded p-2");
    wrap.appendChild(
      el(
        "div",
        "small fw-semibold",
        `"${macro.name || macro.id}" needs ${aliases.length > 1 ? "devices" : "a device"} aliased: ${aliases.join(", ")}`
      )
    );
    const selections = {};
    aliases.forEach((alias) => {
      const row = el("div", "d-flex align-items-center gap-2");
      row.appendChild(el("span", "small text-body-secondary", `"${alias}" →`));
      const select = document.createElement("select");
      select.className = "form-select form-select-sm";
      select.style.maxWidth = "12rem";
      const blank = document.createElement("option");
      blank.value = "";
      blank.textContent = deviceList.length ? "Pick a device…" : "No devices saved yet";
      select.appendChild(blank);
      deviceList.forEach((device) => {
        const option = document.createElement("option");
        option.value = device.ip;
        option.textContent = device.label || device.ip;
        select.appendChild(option);
      });
      select.addEventListener("change", () => {
        selections[alias] = select.value;
      });
      row.appendChild(select);
      wrap.appendChild(row);
    });

    const buttonRow = el("div", "d-flex gap-2");
    const confirmButton = el("button", "btn btn-sm btn-primary", "Save & run");
    confirmButton.type = "button";
    confirmButton.addEventListener("click", () => {
      const unresolved = aliases.filter((alias) => !selections[alias]);
      if (unresolved.length) {
        status?.show?.("Pick a device for every alias listed, or cancel.", { type: "warning", timeout: 2400 });
        return;
      }
      aliases.forEach((alias) => {
        const device = deviceList.find((d) => d.ip === selections[alias]);
        if (device) {
          persistDevices(deviceList.map((d) => (d.ip === device.ip ? { ...d, alias } : d)));
        }
      });
      const target = macro;
      pendingAlias = null;
      void runMacroById(target);
    });
    const cancelButton = el("button", "btn btn-sm btn-outline-secondary", "Cancel");
    cancelButton.type = "button";
    cancelButton.addEventListener("click", () => {
      pendingAlias = null;
      render();
    });
    buttonRow.append(confirmButton, cancelButton);
    wrap.appendChild(buttonRow);
    return wrap;
  }

  function renderMacroButton(macro) {
    const button = el(
      "button",
      "btn btn-outline-primary d-flex flex-column align-items-center gap-1 p-2"
    );
    button.type = "button";
    button.style.minWidth = "5.5rem";
    button.disabled = running.has(macro.id);
    // Read live at render time (correct on mount) and kept in sync while
    // mounted by dashboard.js's own applyEditingState, which toggles this
    // same title by querying [data-macro-run-button] — see that function's
    // own comment. Marker attribute, not a behavior hook: the actual run-
    // vs-edit decision below always reads isEditing() fresh at click time.
    button.dataset.macroRunButton = "";
    button.title = isEditing?.() ? "Edit in Loom" : "Run macro";
    button.appendChild(icon(macro.icon || "tabler:bolt"));
    button.appendChild(el("span", "small", macro.name || macro.id));
    button.addEventListener("click", () => {
      // Running a macro for real (lights, sound, table-visible effects)
      // while the GM is just rearranging the dashboard layout makes no
      // sense — redirect to Loom's own Macro editor, already selected on
      // this macro, instead. Checked live at click time (not a value
      // captured when this button was rendered), since edit mode can be
      // toggled on/off without this widget ever re-rendering.
      if (isEditing?.()) {
        window.location.href = `loom/index.html?macro=${encodeURIComponent(macro.id)}`;
        return;
      }
      void runMacroById(macro);
    });
    return button;
  }

  function render() {
    if (destroyed) return;
    container.innerHTML = "";
    const wrap = el("div", "d-flex flex-column gap-2 overflow-auto");
    wrap.style.minHeight = "0";

    if (pendingAlias) {
      wrap.appendChild(renderAliasPrompt());
    } else if (!macros.length) {
      wrap.appendChild(
        el("div", "small text-body-secondary", "No macros saved yet — create one in Loom (Library → macro).")
      );
    } else {
      const grid = el("div", "d-flex flex-wrap gap-2");
      macros.forEach((macro) => grid.appendChild(renderMacroButton(macro)));
      wrap.appendChild(grid);
    }

    container.appendChild(wrap);
  }

  if (typeof setTitle === "function") setTitle("");
  render();
  void loadMacros();

  return {
    refresh: loadMacros,
    destroy() {
      destroyed = true;
      container.innerHTML = "";
    },
  };
}
