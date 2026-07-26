// "Now showing" widget — polls the group log for the latest spotlight entry
// and renders whatever's currently spotlighted. Maps and Encounters are
// link-only (same LINK_ONLY_KINDS reasoning as spotlight.js/Workbench: a map
// is a pannable canvas and an encounter a live combat state, neither a
// static card), everything else gets a plain name/description — a
// deliberately simpler render than Workbench's real Press-template card
// (that pipeline is tightly coupled to Workbench's print-template flow),
// which is an acceptable v1 trade-off for a lightweight Dashboard widget.
// This single widget also covers the "map" case on its own, since a
// spotlighted map already renders as a link here — no separate map-only
// widget needed.
import { loadLibraryData } from "../content-fetch.js";
import { resolveToolHref, resolveToolContextPath } from "../app-shell.js";
import { connectLiveStream } from "../live.js";
import { LINK_ONLY_KINDS } from "../spotlight.js";
import { el } from "../dom.js";

const POLL_INTERVAL_MS = 30000;

export function initNowShowingWidget(container, { dataManager, groupId = "", shareToken = "" } = {}) {
  if (!container || !dataManager) {
    return { destroy() {} };
  }
  let pollTimer = 0;
  let destroyed = false;
  let lastEntryId = null;

  function renderEmpty(message) {
    container.innerHTML = "";
    container.appendChild(el("p", "text-body-secondary small mb-0", message));
  }

  function renderLink(entity, kind, id) {
    container.innerHTML = "";
    const card = el("div", "border rounded-3 bg-body p-3 d-flex flex-column gap-2");
    card.appendChild(el("div", "fw-semibold", entity?.name || (kind === "map" ? "Map" : "Encounter")));
    const link = el("a", "btn btn-outline-primary btn-sm align-self-start", kind === "map" ? "Open map" : "Open combat tracker");
    const toolId = kind === "map" ? "orrery" : "home";
    const params = new URLSearchParams(kind === "map" ? { map: id } : { encounter: id });
    if (shareToken) params.set("share", shareToken);
    link.href = `${resolveToolHref(toolId, resolveToolContextPath())}?${params.toString()}`;
    link.target = "_blank";
    link.rel = "noopener";
    card.appendChild(link);
    container.appendChild(card);
  }

  function renderCard(entity) {
    container.innerHTML = "";
    const card = el("div", "border rounded-3 bg-body p-3 d-flex flex-column gap-2");
    card.appendChild(el("div", "fw-semibold", entity?.name || "Untitled"));
    if (entity?.description) {
      card.appendChild(el("p", "small text-body-secondary mb-0", entity.description));
    }
    container.appendChild(card);
  }

  async function refresh() {
    if (destroyed || (!groupId && !shareToken)) {
      renderEmpty("No active campaign — pick one from the header menu.");
      return;
    }
    let latest;
    try {
      const log = await dataManager.getGroupLog({ groupId, shareToken, limit: 20 });
      const entries = Array.isArray(log?.entries) ? log.entries : [];
      // The server returns entries oldest-first — sort newest-first before
      // picking "the latest spotlight or clear," so a `spotlight-clear`
      // posted after the last `spotlight` is what actually wins.
      entries.sort((a, b) => (Date.parse(b.created_at) || 0) - (Date.parse(a.created_at) || 0));
      latest = entries.find((entry) => entry?.type === "spotlight" || entry?.type === "spotlight-clear");
    } catch (error) {
      renderEmpty("Unable to load the group log.");
      return;
    }
    if (!latest || latest.type === "spotlight-clear") {
      lastEntryId = null;
      renderEmpty("Nothing is being shown right now.");
      return;
    }
    if (latest.id === lastEntryId) {
      return;
    }
    lastEntryId = latest.id;
    const kind = String(latest.payload?.kind || "").trim();
    const id = String(latest.payload?.id || "").trim();
    if (!kind || !id) {
      renderEmpty("Nothing is being shown right now.");
      return;
    }
    let entity = null;
    try {
      entity = await loadLibraryData(`${kind}/${id}`, dataManager, shareToken);
    } catch (error) {
      renderEmpty("Unable to load the spotlighted item.");
      return;
    }
    if (LINK_ONLY_KINDS.has(kind)) {
      renderLink(entity, kind, id);
    } else {
      renderCard(entity);
    }
  }

  void refresh();
  pollTimer = window.setInterval(() => void refresh(), POLL_INTERVAL_MS);

  // Wakes the existing 30s poll up sooner on a relevant change — see
  // live.js's own comment; polling above keeps running unchanged either way.
  const liveStream = connectLiveStream({ dataManager, groupId, kinds: ["group_log"], shareToken });
  liveStream.subscribe("group_log", () => void refresh());

  return {
    destroy() {
      destroyed = true;
      if (pollTimer) window.clearInterval(pollTimer);
      liveStream.close();
      container.innerHTML = "";
    },
  };
}
