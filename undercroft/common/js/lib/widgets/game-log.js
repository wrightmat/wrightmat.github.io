// Compact Game Log widget for the Dashboard — talks to the same
// getGroupLog/createGroupLogEntry endpoints Workbench's own (much richer)
// game log panel already uses, but as a small, independent renderer rather
// than a literal extraction of that page's tightly-coupled internal state
// (gameLogState/elements.*, built for one page's DOM, not a mountable
// widget). Same polling cadence (30s) and spotlight-entry phrasing.
import { connectLiveStream } from "../live.js";
import { el } from "../dom.js";

const POLL_INTERVAL_MS = 30000;
const CLEARED_WATERMARK_PREFIX = "undercroft.gamelog.clearedBefore.";

// "Clear log" only ever hides entries from *this browser's own view* of a
// campaign's log — the log itself is shared, persistent history for the
// whole group (server/groups.py has no delete-entries capability at all, by
// design), so clearing here is a purely local watermark, not a server call.
// Keyed by whatever this widget instance itself uses to identify the log
// (groupId normally; shareToken for an anonymous share-link viewer with no
// groupId) — same fallback dashboard.js's own catalog entry computes when
// triggering a clear, so the two stay in sync.
function watermarkKey(scope) {
  return `${CLEARED_WATERMARK_PREFIX}${scope}`;
}

// server/groups.py stamps every entry's created_at via Python's
// `datetime.utcnow().isoformat()` — a NAIVE string with no "Z"/offset
// suffix, even though the instant it represents is UTC. JS's Date.parse
// treats a zone-less ISO string as *local* time, not UTC — comparing that
// straight against `new Date().toISOString()` (always proper, explicit UTC)
// silently offsets by the browser's own UTC offset, which is exactly why a
// freshly-set "clear before now" watermark could still leave recent-looking
// entries visible (or hide ones that should stay). Appending "Z" when the
// server's own naive format is detected fixes the comparison for both sides.
function parseTimestamp(value) {
  if (!value) return 0;
  const iso = /[zZ]|[+-]\d{2}:?\d{2}$/.test(value) ? value : `${value}Z`;
  return Date.parse(iso) || 0;
}

function loadClearedWatermark(scope) {
  if (!scope) return "";
  try {
    return localStorage.getItem(watermarkKey(scope)) || "";
  } catch (error) {
    return "";
  }
}

// Exported so dashboard.js's Game Log catalog entry (the header/inspector
// "Clear log" buttons) can set this without reaching into this widget's own
// module-private state — `scope` is `groupId || shareToken`, same as the
// widget's own internal use below.
export function clearGameLogView(scope) {
  if (!scope) return;
  try {
    localStorage.setItem(watermarkKey(scope), new Date().toISOString());
  } catch (error) {
    // Local storage unavailable (private browsing, quota) — nothing to clear
    // locally; harmless no-op, same graceful-degrade as dashboard.js's own
    // saveLocalSetting.
  }
}

// Exported so dashboard.js's spotlight-inbox toast can phrase its prompt the
// same way this widget's own inline entry does — one label table, not two
// copies that could drift apart.
export const SPOTLIGHT_KIND_LABELS = {
  npc: "an NPC",
  location: "a Location",
  monster: "a Monster",
  effect: "an Effect",
  map: "a Map",
  encounter: "an Encounter",
  clock: "a Clock",
  browser: "a link",
  calendar: "a calendar",
  soundboard: "a soundboard",
};

function describeEntry(entry) {
  if (entry?.type === "spotlight") {
    const kind = String(entry.payload?.kind || "").trim();
    const article = SPOTLIGHT_KIND_LABELS[kind] || (kind ? `a "${kind}"` : "something");
    return `Showed ${article} to the table`;
  }
  if (entry?.type === "spotlight-clear") {
    return "Stopped showing to the table";
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

export function initGameLogWidget(
  container,
  { dataManager, status, groupId = "", shareToken = "", onAcceptSpotlight, setRightAction } = {}
) {
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
        const row = el("div", "d-flex flex-column gap-1 small border-bottom pb-1 mb-1");
        const line = el("div", "d-flex justify-content-between gap-2");
        line.appendChild(el("span", null, describeEntry(entry)));
        const meta = el("span", "text-body-secondary");
        meta.textContent = `${entry.author?.name || "System"} · ${formatTimestamp(entry.created_at)}`;
        line.appendChild(meta);
        row.appendChild(line);
        // Lets a player who scrolled past the toast (or missed it) still act
        // on any spotlight entry from here — same acceptSpotlight path
        // dashboard.js's toast prompt uses, just triggered from the log
        // instead. Shown on every spotlight entry, not just the latest one —
        // except whichever ones this viewer posted themselves (a GM doesn't
        // need to "accept" their own show-to-table onto their own dashboard;
        // same reasoning spotlight-inbox.js's toast already applies).
        const isOwnEntry = Boolean(entry?.author?.id) && entry.author.id === dataManager.session?.user?.id;
        if (entry?.type === "spotlight" && !isOwnEntry && typeof onAcceptSpotlight === "function") {
          const acceptButton = el("button", "btn btn-outline-primary btn-sm align-self-start", "Accept");
          acceptButton.type = "button";
          acceptButton.addEventListener("click", () => onAcceptSpotlight(entry));
          row.appendChild(acceptButton);
        }
        list.appendChild(row);
      });
  }

  async function refresh(list) {
    if (destroyed || !groupId && !shareToken) return;
    try {
      const log = await dataManager.getGroupLog({ groupId, shareToken, limit: 20 });
      // `spotlight-update` (data-manager.js's updateSpotlightData) is a
      // silent data refresh on an already-shown inline widget (a Clock tick,
      // a Browser URL edit) — the original `spotlight` entry already
      // announced it, so these carry nothing worth a log row and would
      // otherwise spam one on every single edit.
      const entries = Array.isArray(log?.entries)
        ? log.entries.filter((entry) => entry?.type !== "spotlight-update")
        : [];
      const watermark = loadClearedWatermark(groupId || shareToken);
      const visible = watermark
        ? entries.filter((entry) => parseTimestamp(entry.created_at) > parseTimestamp(watermark))
        : entries;
      renderEntries(list, visible);
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

  function refreshNow() {
    return activeList ? refresh(activeList) : undefined;
  }

  // Purely local — only hides older entries from THIS browser's own view
  // (clearGameLogView's localStorage watermark above); the log itself stays
  // shared, persistent history for the whole campaign, and nothing here
  // ever deletes from it. Always visible (not edit-mode gated like Remove),
  // same convention as Map/Combat Tracker/Handout's own visibility toggle —
  // this is Game Log's equivalent of that same right-side action slot.
  setRightAction?.({
    icon: "tabler:trash",
    tooltip: "Clear log",
    onClick: () => {
      clearGameLogView(groupId || shareToken);
      void refreshNow();
    },
  });

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
    // Exposed for the Widget Inspector's own "Clear log" button too.
    refresh: refreshNow,
    destroy() {
      destroyed = true;
      if (pollTimer) window.clearInterval(pollTimer);
      liveStream.close();
      container.innerHTML = "";
    },
  };
}
