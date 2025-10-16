import { initAppShell } from "../lib/app-shell.js";
import { DataManager } from "../lib/data-manager.js";

const { status } = initAppShell({ namespace: "index" });
status.show("Welcome back to the Workbench", { timeout: 2500 });

function renderRecentCharacters(list) {
  const target = document.querySelector("[data-recent-characters]");
  if (!target) return;
  if (!list.length) {
    return;
  }
  target.innerHTML = "";
  list.slice(0, 5).forEach(({ id, payload }) => {
    const item = document.createElement("li");
    item.className = "border rounded-3 px-3 py-2 fs-6 shadow-sm bg-body-tertiary";
    const name = payload?.name || "Untitled Character";
    item.textContent = name;
    item.dataset.characterId = id;
    target.appendChild(item);
  });
}

try {
  const manager = new DataManager();
  const entries = manager.listLocalEntries("characters");
  renderRecentCharacters(entries);
} catch (error) {
  console.warn("Unable to load recent characters", error);
}
