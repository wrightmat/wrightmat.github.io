// Shows one of the signed-in user's own characters — a quick identity card,
// a live "vitals" section (character-sheet.js's initCharacterVitals) for
// whichever combat-bound fields that character's System defines, and an
// "Open in Workbench" header action for the rest (the full arbitrary-
// template sheet engine lives there). The picked character is also
// reported via onPin, since the Dashboard uses "which character is mine"
// to resolve which campaign group's Game Log/Now Showing/Combat Tracker to show.
import { resolveToolHref, resolveToolContextPath } from "../app-shell.js";
import { initCharacterVitals } from "./character-sheet.js";
import { el } from "../dom.js";

// A character listing entry is one of two shapes: a *remote* one (flat
// title/name fields) or a *local* one ({id, payload, owner, scope}, no flat
// title). Checking both avoids a second, bare-id option for a character
// that exists both remotely and in the local cache.
function labelFor(entry) {
  return (
    entry.title ||
    entry.name ||
    entry.payload?.data?.name ||
    entry.payload?.title ||
    entry.payload?.name ||
    entry.id
  );
}

export function initCharacterSummaryWidget(
  container,
  { dataManager, status, pinnedCharacterId = "", groupId = "", shareToken = "", onPin, setTitle, setHeaderAction } = {}
) {
  if (!container || !dataManager) {
    return { destroy() {} };
  }
  let destroyed = false;
  let vitals = null;

  function characterName(payload, fallbackId) {
    return payload?.data?.name || payload?.title || payload?.name || fallbackId;
  }

  async function loadOwnCharacters() {
    if (!dataManager.isAuthenticated()) {
      return dataManager.listLocalEntries("character") || [];
    }
    const listing = await dataManager.list("character", { refresh: true });
    const remote = dataManager.collectListEntries(listing.remote, ["owned"]);
    const remoteIds = new Set(remote.map((entry) => entry.id));
    const local = (dataManager.listLocalEntries("character") || []).filter((entry) => !remoteIds.has(entry.id));
    return [...remote, ...local];
  }

  function mountVitals(id) {
    vitals?.destroy?.();
    vitals = null;
    const host = el("div");
    if (id) {
      vitals = initCharacterVitals(host, { dataManager, status, characterId: id, groupId, shareToken });
    }
    return host;
  }

  function openInWorkbenchHref(id) {
    const params = new URLSearchParams({ record: `character:${id}` });
    return `${resolveToolHref("workbench", resolveToolContextPath())}?${params.toString()}`;
  }

  async function renderCharacterInto(id, target) {
    target.innerHTML = "";
    if (!id) {
      target.appendChild(el("p", "text-body-secondary small mb-0", "No character picked yet."));
      setTitle?.("");
      setHeaderAction?.(null);
      return;
    }
    try {
      const result = await dataManager.get("character", id);
      const payload = result.payload || {};
      const name = characterName(payload, id);
      setTitle?.(name);
      setHeaderAction?.({ icon: "tabler:external-link", tooltip: "Open in Workbench", href: openInWorkbenchHref(id) });
      const card = el("div", "d-flex flex-column gap-2");
      if (payload.class || payload.species) {
        card.appendChild(el("div", "text-body-secondary small", [payload.species, payload.class].filter(Boolean).join(" · ")));
      }
      card.appendChild(mountVitals(id));
      target.appendChild(card);
    } catch (error) {
      setTitle?.("");
      setHeaderAction?.(null);
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
    entries.forEach((entry) => select.appendChild(new Option(labelFor(entry), entry.id)));
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
      vitals?.destroy?.();
      setHeaderAction?.(null);
      container.innerHTML = "";
    },
  };
}
