// One "Player color" for the whole suite: the Dashboard background, the outline of map tokens linked to your records,
// and anything else that should look like it belongs to you. It is a single setting; every control that edits it
// stays in step through the change event, and an unset color means the theme's own background.
import { el } from "./dom.js";

const STORAGE_KEY = "undercroft.playerColor";
export const PLAYER_COLOR_EVENT = "undercroft:player-color-changed";

function readLocal() {
  try {
    return window.localStorage.getItem(STORAGE_KEY) || "";
  } catch (error) {
    return "";
  }
}

function writeLocal(color) {
  try {
    window.localStorage.setItem(STORAGE_KEY, color);
  } catch (error) {
    // The server copy (when signed in) still holds it.
  }
}

function toHex(cssColor) {
  const match = /rgba?\((\d+),\s*(\d+),\s*(\d+)/.exec(cssColor || "");
  if (!match) return "#000000";
  return `#${[match[1], match[2], match[3]].map((part) => Number(part).toString(16).padStart(2, "0")).join("")}`;
}

// What the page looks like with no Player color chosen.
export function themeDefaultColor() {
  return toHex(window.getComputedStyle(document.body).backgroundColor);
}

export async function readPlayerColor(dataManager, knownSettings) {
  if (dataManager?.isAuthenticated?.()) {
    try {
      const settings = knownSettings || (await dataManager.getUserSettings());
      const color = typeof settings?.playerColor === "string" ? settings.playerColor : "";
      writeLocal(color);
      return color;
    } catch (error) {
      return readLocal();
    }
  }
  return readLocal();
}

function announce(color) {
  window.dispatchEvent(new CustomEvent(PLAYER_COLOR_EVENT, { detail: { color } }));
}

export async function savePlayerColor(dataManager, color) {
  writeLocal(color);
  if (dataManager?.isAuthenticated?.()) await dataManager.saveUserSettings({ playerColor: color });
  announce(color);
}

// Calls back on a change made in this tab (including an unsaved drag in a picker) or in another one.
export function onPlayerColorChange(callback) {
  const local = (event) => callback(event.detail.color);
  const remote = (event) => {
    if (event.key === STORAGE_KEY) callback(event.newValue || "");
  };
  window.addEventListener(PLAYER_COLOR_EVENT, local);
  window.addEventListener("storage", remote);
  return () => {
    window.removeEventListener(PLAYER_COLOR_EVENT, local);
    window.removeEventListener("storage", remote);
  };
}

export function createPlayerColorControl({ dataManager, status, label = "Player color", id = "player-color" } = {}) {
  const wrap = el("div", "template-color-control template-color-control--unset");
  const heading = el("label", "form-label", label);
  heading.htmlFor = id;
  const row = el("div", "d-flex align-items-center gap-2");
  const swatch = el("div", "template-color-swatch position-relative");
  const input = el("input", "form-control-color");
  input.type = "color";
  input.id = id;
  const unsetIcon = el("span", "iconify template-color-unset-icon");
  unsetIcon.dataset.icon = "tabler:x";
  unsetIcon.setAttribute("aria-hidden", "true");
  swatch.append(input, unsetIcon);
  const clear = el("button", "btn btn-outline-secondary btn-sm", "Clear");
  clear.type = "button";
  row.append(swatch, clear);
  wrap.append(heading, row);

  // An unset picker still opens on the color the page is really using.
  function render(color) {
    const isSet = Boolean(color);
    input.value = isSet ? color : themeDefaultColor();
    wrap.classList.toggle("template-color-control--unset", !isSet);
    clear.disabled = !isSet;
    swatch.title = isSet ? "" : `Not set: the theme's own background (${input.value})`;
  }

  async function commit(color, message) {
    try {
      await savePlayerColor(dataManager, color);
      status?.show(message, { type: "success", timeout: 1500 });
    } catch (error) {
      status?.show(error.message || "Unable to save your Player color.", { type: "error" });
    }
  }

  input.addEventListener("input", () => announce(input.value));
  input.addEventListener("change", () => commit(input.value, "Player color saved"));
  clear.addEventListener("click", () => commit("", "Player color cleared"));

  // A control that has been taken out of the page stops listening.
  let wasConnected = false;
  const stopListening = onPlayerColorChange((color) => {
    if (wrap.isConnected) wasConnected = true;
    else if (wasConnected) return stopListening();
    render(color);
  });
  const themeWatcher = new MutationObserver(() => {
    if (!wrap.isConnected) return wasConnected ? themeWatcher.disconnect() : undefined;
    if (wrap.classList.contains("template-color-control--unset")) render("");
  });
  themeWatcher.observe(document.documentElement, { attributes: true, attributeFilter: ["data-theme", "data-bs-theme"] });

  render(readLocal());
  void readPlayerColor(dataManager).then(render);
  return { element: wrap, refresh: () => readPlayerColor(dataManager).then(render) };
}
