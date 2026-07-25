// Shows one of the signed-in user's own characters — just enough to
// recognize it and jump into Workbench for the rest (the full character
// sheet engine lives there; duplicating it here would be a second, weaker
// implementation of the same thing). The picked character is also reported
// via onPin, since the Dashboard uses "which character is mine" to resolve
// which campaign group's Game Log/Now Showing/Combat Tracker to show (see
// group-context.js) — same character-drives-campaign logic Workbench
// itself already uses.
import { resolveToolHref, resolveToolContextPath } from "../app-shell.js";

export function initCharacterSummaryWidget(container, { dataManager, pinnedCharacterId = "", onPin } = {}) {
  if (!container || !dataManager) {
    return { destroy() {} };
  }
  let destroyed = false;

  function el(tag, className, text) {
    const node = document.createElement(tag);
    if (className) node.className = className;
    if (text !== undefined) node.textContent = text;
    return node;
  }

  async function loadOwnCharacters() {
    if (!dataManager.isAuthenticated()) {
      return dataManager.listLocalEntries("character") || [];
    }
    const listing = await dataManager.list("character", { refresh: true });
    const remote = dataManager.collectListEntries(listing.remote, ["owned"]);
    const local = dataManager.listLocalEntries("character") || [];
    return [...remote, ...local];
  }

  async function renderCharacterInto(id, target) {
    target.innerHTML = "";
    if (!id) {
      target.appendChild(el("p", "text-body-secondary small mb-0", "No character picked yet."));
      return;
    }
    try {
      const result = await dataManager.get("character", id);
      const payload = result.payload || {};
      const card = el("div", "border rounded-3 bg-body p-3 d-flex flex-column gap-2");
      card.appendChild(el("div", "fw-semibold fs-5", payload.name || id));
      if (payload.class || payload.species) {
        card.appendChild(el("div", "text-body-secondary small", [payload.species, payload.class].filter(Boolean).join(" · ")));
      }
      const link = el("a", "btn btn-outline-primary btn-sm align-self-start", "Open in Workbench");
      const params = new URLSearchParams({ record: `character:${id}` });
      link.href = `${resolveToolHref("workbench", resolveToolContextPath())}?${params.toString()}`;
      card.appendChild(link);
      target.appendChild(card);
    } catch (error) {
      target.appendChild(el("p", "text-body-secondary small mb-0", "Unable to load that character."));
    }
  }

  async function render() {
    if (destroyed) return;
    container.innerHTML = "";
    const wrap = el("div", "d-flex flex-column gap-3");

    const select = el("select", "form-select form-select-sm");
    select.appendChild(new Option("Pick a character…", ""));
    let entries = [];
    try {
      entries = await loadOwnCharacters();
    } catch (error) {
      entries = [];
    }
    entries.forEach((entry) => select.appendChild(new Option(entry.title || entry.name || entry.id, entry.id)));
    select.value = pinnedCharacterId || "";
    wrap.appendChild(select);

    const detail = el("div");
    wrap.appendChild(detail);
    container.appendChild(wrap);

    select.addEventListener("change", () => {
      onPin?.(select.value);
      void renderCharacterInto(select.value, detail);
    });

    await renderCharacterInto(select.value, detail);
  }

  void render();

  return {
    destroy() {
      destroyed = true;
      container.innerHTML = "";
    },
  };
}
