// A single segmented clock (Blades-in-the-Dark-style progress/countdown
// tracker) — deliberately NOT a Library kind. A clock is just {name,
// segments, filled, direction, autoTick...}, small enough to live entirely
// in this widget instance's own persisted contentRef rather than round-
// tripping through a new server-backed kind. `multiple: true` in the
// dashboard catalog — add the widget again for another clock.
//
// Showing a clock to the table carries this config inline on the spotlight
// entry (server/groups.py's own _INLINE_SPOTLIGHT_KINDS, same design
// browser.js uses) rather than through any Library record — nothing for
// the GM to manage in Loom's Library tab, nothing to clean up beyond
// clearing the spotlight (see destroy(removed) below). A player who
// accepts the spotlight gets a read-only *follower* instance instead (the
// `followKind`/`followId` branch below) that polls/live-watches that same
// spotlight entry's `data` — same design as browser.js's own follower.
import { el } from "../dom.js";
import { connectLiveStream } from "../live.js";
import { resolveIsSpotlighted, resolveSpotlightData } from "../spotlight.js";
import { createReliableInterval } from "../reliable-interval.js";
import { disposeTooltips, refreshTooltips } from "../tooltips.js";

const DEFAULT_CONFIG = {
  name: "New Clock",
  segments: 6,
  filled: 0,
  direction: "up",
  // Empty means "use the direction's own default color" (see
  // defaultColorFor below) — set once the GM actually touches the color
  // picker, and left alone by direction changes after that (an explicit
  // choice shouldn't get silently overwritten by flipping direction).
  color: "",
  // Optional real-time ticking — advances (direction "up") or retreats
  // (direction "down") by one segment every `autoTickSeconds`, so a clock
  // can run down/up on its own during a session without the GM babysitting
  // it. Off by default; auto-disables itself once it hits the end, rather
  // than ticking forever against a wall it can't move past.
  autoTickEnabled: false,
  autoTickSeconds: 60,
};

// --- Macro action support (common/js/lib/widgets/macro-runner.js) --------
// Exported so loom/js/app.js's Macro editor can build the Type/Action
// pickers from the real registry instead of a second, driftable copy.
// `target` is deliberately absent everywhere for this type — there's no
// portable "which clock" to author into a shared macro record, only
// "whichever one is currently shown" (see runMacroAction below).
export const CLOCK_MACRO_ACTIONS = {
  show: { label: "Show to table" },
  hide: { label: "Hide from table" },
  advance: { label: "Advance / retreat", params: ["delta"] },
  set: { label: "Set filled segments", params: ["filled"] },
  // Unlike the actions above (which only act on whichever clock is ALREADY
  // visible), "create" is allowed to add a widget when none exists yet.
  create: { label: "Create new & show" },
};

const POLL_INTERVAL_MS = 5000; // a physical second-screen display wants a clock's tick to feel live

function icon(name) {
  const span = el("span", "iconify");
  span.dataset.icon = name;
  span.setAttribute("aria-hidden", "true");
  return span;
}

// "up" (filling toward a bad/climactic outcome) defaults red, "down"
// (draining a resource) defaults blue — distinct at a glance without the GM
// having to configure anything; the color picker (see the top row below)
// overrides this per clock for whoever wants a different scheme.
function defaultColorFor(direction) {
  return direction === "down" ? "#0ea5e9" : "#dc3545";
}

// A plain segmented bar (not a true pie/clock-face render) — same
// information a Blades clock conveys, at a fraction of the rendering cost.
function renderSegments(config) {
  const wrap = el("div", "d-flex gap-1 flex-wrap");
  const fillColor = config.color || defaultColorFor(config.direction);
  for (let index = 0; index < config.segments; index += 1) {
    const segment = el("span");
    segment.style.width = "1rem";
    segment.style.height = "1rem";
    segment.style.borderRadius = "0.2rem";
    segment.style.display = "inline-block";
    segment.style.border = "1px solid var(--bs-border-color)";
    segment.style.backgroundColor = index < config.filled ? fillColor : "var(--bs-secondary-bg)";
    wrap.appendChild(segment);
  }
  return wrap;
}

function renderFollowerView(container, config) {
  container.innerHTML = "";
  const wrap = el("div", "d-flex flex-column gap-2");
  wrap.appendChild(el("div", "fw-semibold", config.name));
  const clockRow = el("div", "d-flex flex-wrap align-items-center gap-2");
  clockRow.appendChild(renderSegments(config));
  clockRow.appendChild(el("span", "small text-body-secondary", `${config.filled} / ${config.segments}`));
  wrap.appendChild(clockRow);
  container.appendChild(wrap);
}

function renderFollowerEmpty(container) {
  container.innerHTML = "";
  container.appendChild(el("p", "text-body-secondary small mb-0", "The GM isn't showing this clock right now."));
}

// contentRef.followKind === "clock" marks a "follower" instance — created
// by acceptSpotlight when a player accepts a GM's clock spotlight, never by
// manually adding the Clock widget. Purely a read-only mirror, read via
// resolveSpotlightData since there's no Library record to fetch. Same
// shape as browser.js's own initFollowerBrowser.
function initFollowerClock(container, { dataManager, groupId = "", shareToken = "", followId, setTitle }) {
  let destroyed = false;
  let pollTimer = 0;

  async function refresh() {
    try {
      const data = await resolveSpotlightData(dataManager, { groupId, shareToken, kind: "clock", id: followId });
      if (destroyed) return;
      if (!data) {
        renderFollowerEmpty(container);
        return;
      }
      const config = { ...DEFAULT_CONFIG, ...data };
      setTitle?.(config.name);
      renderFollowerView(container, config);
    } catch (error) {
      if (!destroyed) renderFollowerEmpty(container);
    }
  }

  void refresh();
  // createReliableInterval, not plain setInterval — a followed clock popped onto a second screen must not stall unfocused.
  pollTimer = createReliableInterval(() => void refresh(), POLL_INTERVAL_MS);
  // The group log is the one live channel every inline-kind follower watches — matches browser.js's own follower.
  const liveStream = connectLiveStream({ dataManager, groupId, kinds: ["group_log"], shareToken });
  liveStream.subscribe("group_log", () => void refresh());

  return {
    refresh,
    destroy() {
      destroyed = true;
      if (pollTimer) pollTimer.stop();
      liveStream.close();
      container.innerHTML = "";
    },
  };
}

export function initClockWidget(
  container,
  {
    contentRef,
    setContentRef,
    setTitle,
    dataManager,
    status,
    groupId = "",
    shareToken = "",
    canToggleVisibility = false,
    setRightAction,
    instanceId = "",
    forcePlayerView = false,
  } = {}
) {
  if (!container) {
    return { destroy() {} };
  }

  if (contentRef?.followKind === "clock") {
    return initFollowerClock(container, { dataManager, groupId, shareToken, followId: contentRef.followId, setTitle });
  }

  // The second-screen mirror window is a completely independent JS context
  // (window.open, not shared in-page render) — the author render path below
  // only changes `config` via LOCAL persist() calls in that same window, so
  // a forced-player-view instance using it would render one static snapshot
  // forever. Treating it as a follower OF ITSELF — polling the same
  // spotlight data toggleVisibility posts/refreshes — makes it a real live view instead.
  if (forcePlayerView && instanceId) {
    return initFollowerClock(container, {
      dataManager,
      groupId,
      shareToken,
      followId: instanceId,
      setTitle,
    });
  }

  let config = { ...DEFAULT_CONFIG, ...(contentRef || {}) };
  let destroyed = false;
  let autoTickTimer = 0;
  let visible = false;

  function stopAutoTick() {
    if (autoTickTimer) {
      autoTickTimer.stop();
      autoTickTimer = 0;
    }
  }

  // Ticks are driven by the same `direction` the fill color already uses —
  // one setting, not a second one specific to auto-ticking.
  // createReliableInterval, same reliability need as the follower poll above.
  function startAutoTick() {
    stopAutoTick();
    if (!config.autoTickEnabled) return;
    const seconds = Math.max(1, Number(config.autoTickSeconds) || DEFAULT_CONFIG.autoTickSeconds);
    autoTickTimer = createReliableInterval(() => {
      const delta = config.direction === "down" ? -1 : 1;
      const nextFilled = Math.max(0, Math.min(config.segments, config.filled + delta));
      const reachedEnd = nextFilled === config.filled;
      persist({ ...config, filled: nextFilled, autoTickEnabled: reachedEnd ? false : config.autoTickEnabled });
    }, seconds * 1000);
  }

  function updateVisibilityAction() {
    if (!canToggleVisibility) return;
    setRightAction?.({
      icon: visible ? "tabler:eye" : "tabler:eye-off",
      tooltip: visible ? "Showing to table — click to hide" : "Hidden from table — click to show",
      active: visible,
      onClick: () => void toggleVisibility(),
    });
  }

  async function refreshVisibility() {
    if (!canToggleVisibility || !groupId || !instanceId) {
      visible = false;
      return;
    }
    // Per-instance, not just per-kind — every clock is kind "clock" regardless of which one.
    visible = await resolveIsSpotlighted(dataManager, { groupId, shareToken, kind: "clock", id: instanceId });
    updateVisibilityAction();
  }

  // A plain spotlight-update, not a fresh `spotlight` entry — that would
  // re-trigger every other viewer's accept-prompt/Game Log row on every single tick.
  async function pushVisibleUpdate() {
    if (!visible || !dataManager || !instanceId || !groupId) return;
    try {
      await dataManager.updateSpotlightData({ groupId, kind: "clock", id: instanceId, data: config });
    } catch (error) {
      // Best-effort — a follower just won't see this particular tick.
    }
  }

  async function toggleVisibility() {
    if (!groupId || !instanceId) {
      status?.show("No active campaign to show this to.", { type: "warning", timeout: 2500 });
      return;
    }
    try {
      if (visible) {
        await dataManager.clearSpotlight({ groupId, kind: "clock", id: instanceId });
        status?.show("Stopped showing to the table.", { type: "success", timeout: 2000 });
      } else {
        // skipShare — no Library record to grant view permission on; the
        // server enforces the same allowance independently for kind
        // "clock". `data` is this clock's own config, carried inline.
        await dataManager.spotlightToGroup({
          groupId,
          contentType: "clock",
          contentId: instanceId,
          skipShare: true,
          data: config,
        });
        status?.show("Showing to the table.", { type: "success", timeout: 2000 });
      }
    } catch (error) {
      status?.show(error.message || "Unable to update visibility.", { type: "error" });
    }
    await refreshVisibility();
  }

  function persist(next) {
    config = next;
    setContentRef?.(config);
    setTitle?.(config.name);
    render();
    startAutoTick();
    void pushVisibleUpdate();
  }

  // --- Macro action support (common/js/lib/widgets/macro-runner.js) ---
  // No Library record, so no addressable instance id — the only sensible
  // target is "whichever clock is currently shown," resolved by scanning
  // mounted instances for isVisible() === true. show/hide reuse
  // toggleVisibility's logic so running "show" twice is a no-op, not a hide.
  async function runMacroAction(action) {
    const params = action?.params || {};
    if (action?.action === "show" || action?.action === "create") {
      if (!visible) await toggleVisibility();
      return;
    }
    if (action?.action === "hide") {
      if (visible) await toggleVisibility();
      return;
    }
    if (action?.action === "advance") {
      const delta = Number(params.delta ?? 1) || 1;
      persist({ ...config, filled: Math.max(0, Math.min(config.segments, config.filled + delta)) });
      return;
    }
    if (action?.action === "set") {
      const nextFilled = Math.max(0, Math.min(config.segments, Number(params.filled ?? config.filled) || 0));
      persist({ ...config, filled: nextFilled });
      return;
    }
    throw new Error(`Unknown Clock macro action "${action?.action}".`);
  }

  // Only ever reached for a genuine GM-authoring instance — forcePlayerView returns early above.
  function render() {
    if (destroyed) return;
    disposeTooltips(container);
    container.innerHTML = "";
    const wrap = el("div", "d-flex flex-column gap-2");

    // Row 1 — name, segments, direction, color, always one row (no
    // flex-wrap) — the name field is the one that shrinks to make room for the other three.
    const topRow = el("div", "d-flex gap-2 align-items-end");
    const nameWrap = el("div", "flex-grow-1");
    nameWrap.style.minWidth = "3rem";
    const nameInput = document.createElement("input");
    nameInput.type = "text";
    nameInput.className = "form-control form-control-sm";
    nameInput.value = config.name;
    nameInput.addEventListener("change", () => {
      persist({ ...config, name: nameInput.value.trim() || DEFAULT_CONFIG.name });
    });
    nameWrap.appendChild(nameInput);

    const segmentsInput = document.createElement("input");
    segmentsInput.type = "number";
    segmentsInput.className = "form-control form-control-sm";
    segmentsInput.style.width = "4rem";
    segmentsInput.setAttribute("data-bs-toggle", "tooltip");
    segmentsInput.setAttribute("data-bs-title", "Segments");
    segmentsInput.setAttribute("aria-label", "Segments");
    segmentsInput.min = "2";
    segmentsInput.max = "24";
    segmentsInput.value = String(config.segments);
    segmentsInput.addEventListener("change", () => {
      const nextSegments = Math.max(2, Math.min(24, Number(segmentsInput.value) || DEFAULT_CONFIG.segments));
      persist({ ...config, segments: nextSegments, filled: Math.min(config.filled, nextSegments) });
    });

    const directionSelect = document.createElement("select");
    directionSelect.className = "form-select form-select-sm";
    directionSelect.style.width = "auto";
    directionSelect.setAttribute("data-bs-toggle", "tooltip");
    directionSelect.setAttribute("data-bs-title", "Direction");
    directionSelect.setAttribute("aria-label", "Direction");
    directionSelect.appendChild(new Option("Fills up", "up"));
    directionSelect.appendChild(new Option("Counts down", "down"));
    directionSelect.value = config.direction;
    // Switching direction re-arms the clock at its natural starting point —
    // "Counts down" should start full, "Fills up" should start empty.
    directionSelect.addEventListener("change", () => {
      const nextDirection = directionSelect.value;
      persist({ ...config, direction: nextDirection, filled: nextDirection === "down" ? config.segments : 0 });
    });

    const colorInput = document.createElement("input");
    colorInput.type = "color";
    colorInput.className = "form-control form-control-sm form-control-color";
    colorInput.style.width = "2.5rem";
    colorInput.setAttribute("data-bs-toggle", "tooltip");
    colorInput.setAttribute("data-bs-title", "Bar color");
    colorInput.setAttribute("aria-label", "Bar color");
    colorInput.value = config.color || defaultColorFor(config.direction);
    colorInput.addEventListener("change", () => persist({ ...config, color: colorInput.value }));

    topRow.append(nameWrap, segmentsInput, directionSelect, colorInput);
    wrap.appendChild(topRow);

    // Row 2 — the clock itself: segments, then +/-/reset.
    const clockRow = el("div", "d-flex flex-wrap align-items-center gap-2");
    clockRow.appendChild(renderSegments(config));
    const minusButton = el("button", "btn btn-sm btn-outline-secondary");
    minusButton.type = "button";
    minusButton.setAttribute("aria-label", "Retreat");
    minusButton.setAttribute("data-bs-toggle", "tooltip");
    minusButton.setAttribute("data-bs-title", "Retreat");
    minusButton.appendChild(icon("tabler:minus"));
    minusButton.addEventListener("click", () => persist({ ...config, filled: Math.max(0, config.filled - 1) }));
    const plusButton = el("button", "btn btn-sm btn-outline-secondary");
    plusButton.type = "button";
    plusButton.setAttribute("aria-label", "Advance");
    plusButton.setAttribute("data-bs-toggle", "tooltip");
    plusButton.setAttribute("data-bs-title", "Advance");
    plusButton.appendChild(icon("tabler:plus"));
    plusButton.addEventListener("click", () =>
      persist({ ...config, filled: Math.min(config.segments, config.filled + 1) })
    );
    // Same natural-start rule as switching direction.
    const resetButton = el("button", "btn btn-sm btn-outline-secondary");
    resetButton.type = "button";
    resetButton.setAttribute("aria-label", "Reset");
    resetButton.setAttribute("data-bs-toggle", "tooltip");
    resetButton.setAttribute("data-bs-title", "Reset");
    resetButton.appendChild(icon("tabler:refresh"));
    resetButton.addEventListener("click", () =>
      persist({ ...config, filled: config.direction === "down" ? config.segments : 0 })
    );
    clockRow.append(
      minusButton,
      el("span", "small text-body-secondary", `${config.filled} / ${config.segments}`),
      plusButton,
      resetButton
    );
    wrap.appendChild(clockRow);

    // Row 3 — optional auto-tick.
    const autoRow = el("div", "d-flex flex-wrap align-items-center gap-2");
    const autoCheckWrap = el("div", "form-check form-switch mb-0");
    const autoCheck = document.createElement("input");
    autoCheck.type = "checkbox";
    autoCheck.className = "form-check-input";
    autoCheck.id = `clock-auto-${Math.random().toString(36).slice(2, 8)}`;
    autoCheck.checked = config.autoTickEnabled;
    autoCheck.addEventListener("change", () => persist({ ...config, autoTickEnabled: autoCheck.checked }));
    const autoLabel = document.createElement("label");
    autoLabel.className = "form-check-label small text-body-secondary";
    autoLabel.htmlFor = autoCheck.id;
    autoLabel.textContent = "Auto";
    autoCheckWrap.append(autoCheck, autoLabel);
    const autoSecondsInput = document.createElement("input");
    autoSecondsInput.type = "number";
    autoSecondsInput.className = "form-control form-control-sm";
    autoSecondsInput.style.width = "5rem";
    autoSecondsInput.min = "1";
    autoSecondsInput.value = String(config.autoTickSeconds);
    autoSecondsInput.addEventListener("change", () => {
      const nextSeconds = Math.max(1, Number(autoSecondsInput.value) || DEFAULT_CONFIG.autoTickSeconds);
      persist({ ...config, autoTickSeconds: nextSeconds });
    });
    autoRow.append(autoCheckWrap, autoSecondsInput, el("span", "small text-body-secondary", "sec"));
    wrap.appendChild(autoRow);

    container.appendChild(wrap);
    refreshTooltips(container);
  }

  render();
  setTitle?.(config.name);
  if (!contentRef) setContentRef?.(config); // first mount — persist the default immediately so a reload doesn't lose it
  startAutoTick();
  void refreshVisibility();

  return {
    runMacroAction,
    // Read by dashboard.js's findActiveWidgetInstance to find which mounted Clock instance a macro should touch.
    isVisible: () => visible,
    // `removed` is only true from dashboard.js's removeWidget — the one
    // moment this instance's still-active spotlight needs clearing (no Library record to make this automatic).
    async destroy(removed) {
      destroyed = true;
      stopAutoTick();
      disposeTooltips(container);
      container.innerHTML = "";
      if (removed && visible && groupId && instanceId) {
        try {
          await dataManager.clearSpotlight({ groupId, kind: "clock", id: instanceId });
        } catch (error) {
          // Best-effort cleanup — nothing meaningful to do if this fails.
        }
      }
    },
  };
}
