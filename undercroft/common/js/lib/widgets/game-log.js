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

// Exported so dashboard.js's spotlight panel can phrase things the same way
// this widget's own inline entry does — one label table, not two copies
// that could drift apart. Also the fallback text whenever a real resource
// title (fetched separately, see describeEntry/dashboard.js's own title
// cache) isn't available yet or doesn't apply.
export const SPOTLIGHT_KIND_LABELS = {
  npc: "an NPC",
  location: "a Location",
  monster: "a Monster",
  effect: "an Effect",
  journal: "a Journal page",
  map: "a Map",
  encounter: "an Encounter",
  clock: "a Clock",
  browser: "a link",
  calendar: "a calendar",
  soundboard: "a soundboard",
};

// Leading icon + whether it should be a clickable on/off toggle for every
// entry type — `resolveKindIcon(kind)` (dashboard.js's own, threaded
// through from initGameLogWidget below) returns undefined for a kind
// KIND_WIDGET_MAP doesn't recognize, which is exactly the signal used here
// to render a plain, non-interactive icon instead of a dead click target
// (the old Accept button had no such gate at all — a real inconsistency
// with the toast's own equivalent check, fixed here).
function resolveEntryIcon(entry, resolveKindIcon) {
  if (entry?.type === "message") {
    return { icon: "tabler:message-circle", clickable: false };
  }
  if (entry?.type === "roll") {
    return { icon: "tabler:dice-5", clickable: false };
  }
  if (entry?.type === "spotlight") {
    const kind = String(entry.payload?.kind || "").trim();
    const id = String(entry.payload?.id || "").trim();
    const templateId = String(entry.payload?.templateId || "").trim();
    const icon = kind ? resolveKindIcon?.(kind) : undefined;
    return { icon: icon || "tabler:sparkles", clickable: Boolean(icon), kind, id, templateId };
  }
  if (entry?.type === "spotlight-clear") {
    const kind = String(entry.payload?.kind || "").trim();
    const icon = kind ? resolveKindIcon?.(kind) : undefined;
    return { icon: icon || "tabler:eye-off", clickable: false, muted: true };
  }
  return { icon: "tabler:message-circle", clickable: false };
}

// `getCachedTitle(kind,id)`/`ensureTitleCached(kind,id,onLoaded)` — dashboard
// .js's own shared title cache (fetch-once, cache, re-render-on-resolve,
// same shape as the character-payload caches elsewhere in this suite).
// Spotlight log entries never carry a title themselves (server/groups.py's
// own payload validation only ever requires kind+id) — a real name for a
// Library-backed kind needs that separate fetch. The four inline kinds
// (clock/browser/calendar/soundboard) have no Library record to fetch at
// all; clock/browser are the only two whose own spotlight `data` payload
// happens to carry something nameable (a GM-set clock name, a raw URL) —
// calendar/soundboard fall back to the generic label like before.
function describeEntry(entry, { getCachedTitle, ensureTitleCached, onTitleLoaded } = {}) {
  if (entry?.type === "spotlight") {
    const kind = String(entry.payload?.kind || "").trim();
    const id = String(entry.payload?.id || "").trim();
    const genericArticle = SPOTLIGHT_KIND_LABELS[kind] || (kind ? `a "${kind}"` : "something");
    let detail = "";
    if (kind === "clock") {
      detail = entry.payload?.data?.name || "";
    } else if (kind === "browser") {
      detail = entry.payload?.data?.url || "";
    } else if (kind && id) {
      detail = getCachedTitle?.(kind, id) || "";
      if (!detail) ensureTitleCached?.(kind, id, onTitleLoaded);
    }
    return `Showed ${detail || genericArticle} to the table`;
  }
  if (entry?.type === "spotlight-clear") {
    return "Stopped showing to the table";
  }
  if (entry?.type === "roll") {
    // A roll entry's own `message` is always empty — the real data lives in
    // `payload.{label,expression,notation,total}` (dice-roll.js's own
    // rollExpression). Mirrors Workbench's own richer log panel formatting
    // (workbench-character-view.js's createGameLogEntryElement) instead of
    // leaving this blank, which is what the old generic `entry?.message ||
    // ""` fallback used to do for every single roll.
    const payload = entry.payload || {};
    const label = typeof payload.label === "string" ? payload.label.trim() : "";
    const notation =
      typeof payload.expression === "string" && payload.expression.trim()
        ? payload.expression.trim()
        : typeof payload.notation === "string" && payload.notation.trim()
          ? payload.notation.trim()
          : "";
    const total = payload.total !== undefined && payload.total !== null ? payload.total : "";
    let text = label && notation ? `${label} (${notation})` : label || notation || "Roll";
    if (total || total === 0) text += ` → ${total}`;
    return text;
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
  {
    dataManager,
    status,
    groupId = "",
    shareToken = "",
    resolveKindIcon,
    isSpotlightOnDashboard,
    onToggleSpotlight,
    ensureTitleCached,
    getCachedTitle,
    setRightAction,
  } = {}
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
        const visual = resolveEntryIcon(entry, resolveKindIcon);
        const row = el("div", "d-flex align-items-start gap-2 small border-bottom pb-1 mb-1");

        const iconEl = el(visual.clickable ? "button" : "span", "gamelog-entry-icon");
        if (visual.clickable) {
          iconEl.type = "button";
          iconEl.classList.add("gamelog-entry-icon--clickable");
          // Not gated on authorship — a GM's own spotlighted item is
          // "on their dashboard" by construction (their own widget is what
          // gets toggled), and toggling it off here is exactly as
          // meaningful as doing it from the panel; keeping both surfaces
          // consistent is the whole point of this rework.
          const isOn = Boolean(isSpotlightOnDashboard?.({ kind: visual.kind, id: visual.id }));
          iconEl.classList.add(isOn ? "spotlight-panel-icon--mine" : "spotlight-panel-icon--available");
          iconEl.title = isOn ? "On your dashboard — click to remove" : "Click to add to your dashboard";
          iconEl.addEventListener("click", () =>
            onToggleSpotlight?.({ kind: visual.kind, id: visual.id, templateId: visual.templateId })
          );
        } else if (visual.muted) {
          iconEl.classList.add("gamelog-entry-icon--muted");
        }
        const iconGlyph = el("span", "iconify");
        iconGlyph.dataset.icon = visual.icon;
        iconGlyph.setAttribute("aria-hidden", "true");
        iconEl.appendChild(iconGlyph);
        row.appendChild(iconEl);

        const body = el("div", "d-flex flex-column gap-1 flex-grow-1");
        const line = el("div", "d-flex justify-content-between gap-2");
        line.appendChild(
          el(
            "span",
            null,
            describeEntry(entry, { getCachedTitle, ensureTitleCached, onTitleLoaded: () => refreshNow() })
          )
        );
        const meta = el("span", "text-body-secondary gamelog-entry-meta");
        meta.textContent = `${entry.author?.name || "System"} · ${formatTimestamp(entry.created_at)}`;
        line.appendChild(meta);
        body.appendChild(line);
        row.appendChild(body);

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
