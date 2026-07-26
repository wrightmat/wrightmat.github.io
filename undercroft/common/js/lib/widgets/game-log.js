// Compact Game Log widget for the Dashboard — talks to the same
// getGroupLog/createGroupLogEntry endpoints Workbench's own (much richer)
// game log panel already uses, but as a small, independent renderer rather
// than a literal extraction of that page's tightly-coupled internal state
// (gameLogState/elements.*, built for one page's DOM, not a mountable
// widget). Same polling cadence (30s) and spotlight-entry phrasing.
import { connectLiveStream } from "../live.js";
import { el } from "../dom.js";

const POLL_INTERVAL_MS = 30000;

const SPOTLIGHT_KIND_LABELS = {
  npc: "an NPC",
  location: "a Location",
  monster: "a Monster",
  effect: "an Effect",
  map: "a Map",
  encounter: "an Encounter",
};

function describeEntry(entry) {
  if (entry?.type === "spotlight") {
    const kind = String(entry.payload?.kind || "").trim();
    const article = SPOTLIGHT_KIND_LABELS[kind] || (kind ? `a "${kind}"` : "something");
    return `Showed ${article} to the table`;
  }
  return entry?.message || "";
}

function formatTimestamp(value) {
  if (!value) return "";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  try {
    return date.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
  } catch (error) {
    return date.toISOString();
  }
}

export function initGameLogWidget(container, { dataManager, status, groupId = "", shareToken = "" } = {}) {
  if (!container || !dataManager) {
    return { destroy() {} };
  }
  let pollTimer = 0;
  let destroyed = false;
  let activeList = null;

  function renderEntries(list, entries) {
    list.innerHTML = "";
    if (!entries.length) {
      list.appendChild(el("p", "text-body-secondary small mb-0", "No log activity yet."));
      return;
    }
    entries
      .slice()
      .sort((a, b) => (Date.parse(b.created_at) || 0) - (Date.parse(a.created_at) || 0))
      .forEach((entry) => {
        const row = el("div", "d-flex justify-content-between gap-2 small border-bottom pb-1 mb-1");
        row.appendChild(el("span", null, describeEntry(entry)));
        const meta = el("span", "text-body-secondary");
        meta.textContent = `${entry.author?.name || "System"} · ${formatTimestamp(entry.created_at)}`;
        row.appendChild(meta);
        list.appendChild(row);
      });
  }

  async function refresh(list) {
    if (destroyed || !groupId && !shareToken) return;
    try {
      const log = await dataManager.getGroupLog({ groupId, shareToken, limit: 20 });
      renderEntries(list, Array.isArray(log?.entries) ? log.entries : []);
    } catch (error) {
      list.innerHTML = "";
      list.appendChild(el("p", "text-danger small mb-0", "Unable to load the log."));
    }
  }

  function render() {
    container.innerHTML = "";
    activeList = null;
    if (!groupId && !shareToken) {
      container.appendChild(el("p", "text-body-secondary small mb-0", "No active campaign — pick one from the header menu."));
      return;
    }
    const wrap = el("div", "d-flex flex-column gap-2");
    const list = el("div");
    activeList = list;
    wrap.appendChild(list);

    if (dataManager.isAuthenticated()) {
      const form = el("form", "d-flex gap-2");
      const input = el("input", "form-control form-control-sm");
      input.type = "text";
      input.placeholder = "Post a message…";
      const button = el("button", "btn btn-outline-primary btn-sm", "Send");
      button.type = "submit";
      form.append(input, button);
      form.addEventListener("submit", async (event) => {
        event.preventDefault();
        const message = input.value.trim();
        if (!message) return;
        try {
          await dataManager.createGroupLogEntry({ groupId, shareToken, type: "message", message });
          input.value = "";
          await refresh(list);
        } catch (error) {
          status?.show(error.message || "Unable to post to the log.", { type: "error" });
        }
      });
      wrap.appendChild(form);
    }

    container.appendChild(wrap);
    void refresh(list);
  }

  render();
  pollTimer = window.setInterval(() => {
    if (activeList) void refresh(activeList);
  }, POLL_INTERVAL_MS);

  // Wakes the existing 30s poll up sooner on a relevant change — see
  // live.js's own comment; polling above keeps running unchanged either way.
  const liveStream = connectLiveStream({ dataManager, groupId, kinds: ["group_log"], shareToken });
  liveStream.subscribe("group_log", () => {
    if (activeList) void refresh(activeList);
  });

  return {
    destroy() {
      destroyed = true;
      if (pollTimer) window.clearInterval(pollTimer);
      liveStream.close();
      container.innerHTML = "";
    },
  };
}
