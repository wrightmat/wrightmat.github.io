// Tracks "what day is it" (and optionally "what time is it") against a
// Setting's own optional calendar vocabulary (months, weekday names, moon
// cycles — authored in Sanctum, sanctum/js/app.js's own Calendar section on
// the Setting record). Unlike Clock, this widget references a REAL Library
// record (the Setting) a follower needs read access to — so showing it to
// the table is a hybrid of two existing patterns: Handout/Map's own
// record-sharing step (grants access to the Setting) plus Clock/Browser's
// inline-spotlight-data step (the widget instance itself has no Library
// record of its own, just a running day/time — see server/groups.py's own
// _INLINE_SPOTLIGHT_KINDS).
//
// `contentRef` = `{ settingId, dayIndex, time }` — `settingId` is picked
// once via the Content Picker when the widget is added and never changes
// after that (Map/Handout's own convention: pick again by removing and
// re-adding, not by editing in place); `dayIndex` (day 0 = campaign start,
// negative days go before it) and `time` (see normalizeTime below) are this
// instance's own running state, mutated via setContentRef exactly like
// Clock's own `filled`.
import { el } from "../dom.js";
import { connectLiveStream } from "../live.js";
import { resolveIsSpotlighted, resolveSpotlightData } from "../spotlight.js";
import { createReliableInterval } from "../reliable-interval.js";

// 5s — same cadence Clock/Browser's own follower/GM polls use.
const POLL_INTERVAL_MS = 5000;
const MINUTES_PER_DAY = 1440;

// `calendar.months` must be non-empty — callers branch around this
// themselves (see describeDate) rather than pretending a missing month
// structure is "a 365-day placeholder year," which would just show a
// confusing blank month name.
function formatCalendarDate(calendar, dayIndex) {
  const months = calendar.months;
  const totalDays = months.reduce((sum, month) => sum + (Number(month.days) || 0), 0) || 1;
  const yearsElapsed = Math.floor(dayIndex / totalDays);
  const year = (Number(calendar.startingYear) || 0) + yearsElapsed;
  let remaining = ((dayIndex % totalDays) + totalDays) % totalDays;
  let monthIndex = 0;
  for (; monthIndex < months.length - 1; monthIndex += 1) {
    const monthDays = Number(months[monthIndex].days) || 0;
    if (remaining < monthDays) break;
    remaining -= monthDays;
  }
  const monthDays = Number(months[monthIndex]?.days) || 0;
  const monthName = months[monthIndex]?.name || `Month ${monthIndex + 1}`;
  let weekdayName = "";
  const daysPerWeek = Number(calendar.daysPerWeek) || 0;
  if (daysPerWeek > 0) {
    const weekdayIndex = ((dayIndex % daysPerWeek) + daysPerWeek) % daysPerWeek;
    weekdayName = calendar.weekdayNames?.[weekdayIndex] || "";
  }
  return { year, monthIndex, monthName, monthDays, dayOfMonth: remaining + 1, weekdayName };
}

// Position within a moon's own cycle, translated to a plain 4-phase label —
// not astronomically precise (no real-world epoch alignment), just enough
// for "roughly what phase is it" at the table.
function formatMoonPhase(cycle, dayIndex) {
  const period = Number(cycle?.days) || 0;
  if (period <= 0) return "";
  const position = ((dayIndex % period) + period) % period;
  const fraction = position / period;
  if (fraction < 0.125 || fraction >= 0.875) return "New";
  if (fraction < 0.375) return "Waxing";
  if (fraction < 0.625) return "Full";
  return "Waning";
}

function describeDate(calendar, dayIndex) {
  const epoch = calendar?.epochLabel ? ` ${calendar.epochLabel}` : "";
  const months = calendar?.months || [];
  if (!months.length) {
    const startingYear = Number(calendar?.startingYear) || 0;
    return `Day ${dayIndex}${startingYear ? `, Year ${startingYear}` : ""}${epoch}`;
  }
  const { year, monthName, dayOfMonth, weekdayName } = formatCalendarDate(calendar, dayIndex);
  const weekdayPrefix = weekdayName ? `${weekdayName}, ` : "";
  return `${weekdayPrefix}${dayOfMonth} ${monthName}, ${year}${epoch}`;
}

function formatTimeOfDay(minutesOfDay) {
  const raw = Number(minutesOfDay) || 0;
  const total = ((raw % MINUTES_PER_DAY) + MINUTES_PER_DAY) % MINUTES_PER_DAY;
  const hours = Math.floor(total / 60);
  const minutes = total % 60;
  return `${String(hours).padStart(2, "0")}:${String(minutes).padStart(2, "0")}`;
}

// Every cell for the CURRENT month, in weekday-column order — `null` for
// the leading blanks before day 1 lands in its actual weekday column.
// Requires both `months` and `daysPerWeek` to be set (there's no "week" to
// lay a grid out against otherwise) — returns null if either is missing,
// so the caller just skips the grid and falls back to the plain date text.
function buildMonthGrid(calendar, dayIndex) {
  const daysPerWeek = Number(calendar.daysPerWeek) || 0;
  if (!daysPerWeek || !calendar.months?.length) return null;
  const { monthDays, dayOfMonth } = formatCalendarDate(calendar, dayIndex);
  const firstOfMonthIndex = dayIndex - (dayOfMonth - 1);
  const firstWeekdayIndex = ((firstOfMonthIndex % daysPerWeek) + daysPerWeek) % daysPerWeek;
  const cells = new Array(firstWeekdayIndex).fill(null);
  for (let day = 1; day <= monthDays; day += 1) cells.push(day);
  return { cells, currentDay: dayOfMonth, daysPerWeek, firstOfMonthIndex };
}

// `onDayClick(targetDayIndex)` — optional, omitted entirely for read-only
// views (followers, the second-screen mirror). Passed the absolute dayIndex
// for whichever cell was clicked (computed from the grid's own
// firstOfMonthIndex), not just a bare day-of-month number, so the caller
// never has to re-derive it.
function renderMonthGrid(container, calendar, dayIndex, onDayClick) {
  const grid = buildMonthGrid(calendar, dayIndex);
  if (!grid) return;
  const gridEl = document.createElement("div");
  gridEl.style.display = "grid";
  gridEl.style.gridTemplateColumns = `repeat(${grid.daysPerWeek}, 1fr)`;
  gridEl.style.gap = "2px";
  for (let i = 0; i < grid.daysPerWeek; i += 1) {
    const label = calendar.weekdayNames?.[i] || `D${i + 1}`;
    const header = el("div", "text-center text-body-secondary", label.slice(0, 3));
    header.style.fontSize = "0.7rem";
    header.style.fontWeight = "600";
    gridEl.appendChild(header);
  }
  grid.cells.forEach((day) => {
    const cell = document.createElement("div");
    cell.className = "text-center";
    cell.style.fontSize = "0.75rem";
    cell.style.padding = "0.2rem 0";
    cell.style.borderRadius = "0.25rem";
    if (day !== null) {
      cell.textContent = String(day);
      if (day === grid.currentDay) {
        cell.style.background = "var(--bs-primary, #0d6efd)";
        cell.style.color = "#fff";
        cell.style.fontWeight = "600";
      }
      if (onDayClick) {
        cell.style.cursor = "pointer";
        cell.title = "Jump to this day";
        cell.addEventListener("click", () => onDayClick(grid.firstOfMonthIndex + (day - 1)));
      }
    }
    gridEl.appendChild(cell);
  });
  container.appendChild(gridEl);
}

// Read-only display — shared by the GM's own view and every follower/
// second-screen view, so the calendar always reads identically everywhere.
// `headingExtra` (the month/day-stepper buttons), `time` (only passed by
// followers — the GM's own author view renders its own interactive time
// section instead, see initCalendarWidget's own render()), and `onDayClick`
// (also author-only — followers never get a clickable grid) are all optional.
function renderCalendarView(container, calendar, dayIndex, { headingExtra, time, onDayClick } = {}) {
  container.innerHTML = "";
  const wrap = el("div", "d-flex flex-column gap-2");
  // flex-wrap — the date text plus both a Month and a Day stepper group
  // (each with its own text label) can be wider than a narrow dashboard
  // card; wrapping to a second line beats clipping or overflowing.
  const headingRow = el("div", "d-flex align-items-center justify-content-between gap-2 flex-wrap");
  headingRow.appendChild(el("div", "fw-semibold", describeDate(calendar, dayIndex)));
  if (headingExtra) headingRow.appendChild(headingExtra);
  wrap.appendChild(headingRow);

  const gridHost = document.createElement("div");
  renderMonthGrid(gridHost, calendar, dayIndex, onDayClick);
  if (gridHost.childNodes.length) wrap.appendChild(gridHost);

  if (calendar.moonCycles?.length) {
    const moonLine = calendar.moonCycles.map((cycle) => `${cycle.name}: ${formatMoonPhase(cycle, dayIndex)}`).join(" · ");
    wrap.appendChild(el("div", "small text-body-secondary", moonLine));
  }

  if (time?.enabled) {
    wrap.appendChild(el("div", "small", formatTimeOfDay(time.minutesOfDay)));
  }

  container.appendChild(wrap);
}

function renderFollowerEmpty(container) {
  container.innerHTML = "";
  container.appendChild(el("p", "text-body-secondary small mb-0", "The GM isn't showing this calendar right now."));
}

// contentRef.followKind === "calendar" marks a follower instance — created
// by acceptSpotlight (dashboard.js) when a player accepts a GM's calendar
// spotlight, or by the forcePlayerView self-follow branch below for the
// second-screen mirror. Reads the running day/time from the spotlight
// entry's own inline data (resolveSpotlightData — no Library record for the
// widget instance itself), then fetches the referenced Setting (readable via
// the share grant toggleVisibility already made) purely for its `.calendar`
// vocabulary.
function initFollowerCalendar(container, { dataManager, groupId = "", shareToken = "", followId, setTitle }) {
  let destroyed = false;
  let pollTimer = 0;

  async function refresh() {
    try {
      const data = await resolveSpotlightData(dataManager, { groupId, shareToken, kind: "calendar", id: followId });
      if (destroyed) return;
      if (!data?.settingId) {
        renderFollowerEmpty(container);
        setTitle?.("Calendar");
        return;
      }
      const result = await dataManager.get("setting", data.settingId, { shareToken, preferLocal: false }).catch(() => null);
      if (destroyed) return;
      const calendar = result?.payload?.calendar;
      if (!calendar) {
        renderFollowerEmpty(container);
        return;
      }
      setTitle?.(result?.payload?.name ? `${result.payload.name} Calendar` : "Calendar");
      renderCalendarView(container, calendar, Number(data.dayIndex) || 0, { time: data.time });
    } catch (error) {
      if (!destroyed) renderFollowerEmpty(container);
    }
  }

  void refresh();
  // createReliableInterval — same reasoning as every other follower in this
  // suite: a followed widget popped onto a physical second screen (or just
  // left unfocused) needs a poll that survives being backgrounded.
  pollTimer = createReliableInterval(() => void refresh(), POLL_INTERVAL_MS);
  // The group log is the one live channel every inline-kind follower
  // watches — matches Clock/Browser's own followers.
  const liveStream = connectLiveStream({ dataManager, groupId, kinds: ["group_log"], shareToken });
  liveStream.subscribe("group_log", () => void refresh());

  return {
    destroy() {
      destroyed = true;
      if (pollTimer) pollTimer.stop();
      liveStream.close();
      container.innerHTML = "";
    },
  };
}

function normalizeTime(raw) {
  return {
    enabled: Boolean(raw?.enabled),
    minutesOfDay: Number.isFinite(Number(raw?.minutesOfDay))
      ? ((Number(raw.minutesOfDay) % MINUTES_PER_DAY) + MINUTES_PER_DAY) % MINUTES_PER_DAY
      : 480,
    // Auto-tick — same shape as Clock's own autoTickEnabled/autoTickSeconds,
    // plus autoTickMinutes (how much game time each tick advances), so a GM
    // can set e.g. "6 real seconds = 1 game minute" or "1 real second = 10
    // game minutes" for a faster-moving downtime montage.
    autoTickEnabled: Boolean(raw?.autoTickEnabled),
    autoTickSeconds: Math.max(1, Number(raw?.autoTickSeconds) || 6),
    autoTickMinutes: Math.max(1, Number(raw?.autoTickMinutes) || 1),
  };
}

function icon(name) {
  const span = el("span", "iconify");
  span.dataset.icon = name;
  span.setAttribute("aria-hidden", "true");
  return span;
}

function iconButton(name, title) {
  const button = el("button", "btn btn-sm btn-outline-secondary");
  button.type = "button";
  // Bootstrap's own spacing scale jumps straight from p-0 (0) to p-1
  // (0.25rem) — deliberately finer/shorter than either, since these are
  // icon-only steppers with no text label to keep clear of.
  button.style.padding = "0.1rem 0.4rem";
  button.appendChild(icon(name));
  button.title = title;
  button.setAttribute("aria-label", title);
  return button;
}

export function initCalendarWidget(
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
  if (!container || !dataManager) {
    return { destroy() {} };
  }

  if (contentRef?.followKind === "calendar") {
    return initFollowerCalendar(container, { dataManager, groupId, shareToken, followId: contentRef.followId, setTitle });
  }

  // Same reasoning Clock's own header comment gives for its forcePlayerView
  // branch: the second-screen mirror is a fully separate JS context (a real
  // window.open, not shared page state), so treating it as a follower OF
  // ITSELF — reading back whatever toggleVisibility already broadcasts — is
  // what makes it a live view instead of one static snapshot at mount time.
  if (forcePlayerView && instanceId) {
    return initFollowerCalendar(container, { dataManager, groupId, shareToken, followId: instanceId, setTitle });
  }

  // settingId is picked once via the Content Picker before this widget is
  // even added (dashboard.js's own pickContentRef convention, same as Map/
  // Handout) and never changes after that — picking a different Setting
  // means removing this widget and adding a new one, same as Map/Handout's
  // own "pick again" story.
  const settingId = contentRef?.settingId || "";
  let dayIndex = Number(contentRef?.dayIndex) || 0;
  let time = normalizeTime(contentRef?.time);
  let destroyed = false;
  let visible = false;
  let settingRecord = null;
  let autoTickTimer = 0;

  async function loadSettingRecord() {
    if (!settingId) {
      settingRecord = null;
      return;
    }
    try {
      settingRecord = (await dataManager.get("setting", settingId))?.payload || null;
    } catch (error) {
      settingRecord = null;
    }
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
    visible = await resolveIsSpotlighted(dataManager, { groupId, shareToken, kind: "calendar", id: instanceId });
    updateVisibilityAction();
  }

  // Keeps a follower's next poll current with the day/time — called after
  // every change while this instance is the one currently visible. A plain
  // spotlight-update (not a fresh `spotlight` entry), same reasoning
  // Clock's own pushVisibleUpdate gives: a fresh `spotlight` would
  // re-trigger every other viewer's accept-prompt/Game Log row on every
  // single day/time advance.
  async function pushVisibleUpdate() {
    if (!visible || !instanceId || !groupId) return;
    try {
      await dataManager.updateSpotlightData({ groupId, kind: "calendar", id: instanceId, data: { settingId, dayIndex, time } });
    } catch (error) {
      // Best-effort — a follower just won't see this particular change yet.
    }
  }

  async function toggleVisibility() {
    if (!groupId || !instanceId) {
      status?.show("No active campaign to show this to.", { type: "warning", timeout: 2500 });
      return;
    }
    try {
      if (visible) {
        await dataManager.clearSpotlight({ groupId, kind: "calendar", id: instanceId });
        status?.show("Stopped showing to the table.", { type: "success", timeout: 2000 });
      } else {
        // Grants read access to the Setting's own vocabulary — this
        // widget's own spotlight entry (below) carries no Library record at
        // all (skipShare:true), only the current day/time; a follower needs
        // this separate grant to fetch the Setting for `.calendar`.
        await dataManager.shareWithGroup({ contentType: "setting", contentId: settingId, groupId, permissions: "view" });
        await dataManager.spotlightToGroup({
          groupId,
          contentType: "calendar",
          contentId: instanceId,
          skipShare: true,
          data: { settingId, dayIndex, time },
        });
        status?.show("Showing to the table.", { type: "success", timeout: 2000 });
      }
    } catch (error) {
      status?.show(error.message || "Unable to update visibility.", { type: "error" });
    }
    await refreshVisibility();
  }

  function stopAutoTick() {
    if (autoTickTimer) {
      autoTickTimer.stop();
      autoTickTimer = 0;
    }
  }

  function startAutoTick() {
    stopAutoTick();
    if (!time.enabled || !time.autoTickEnabled) return;
    autoTickTimer = createReliableInterval(() => advanceTime(time.autoTickMinutes), time.autoTickSeconds * 1000);
  }

  function persistState(patch) {
    if (patch.dayIndex !== undefined) dayIndex = patch.dayIndex;
    if (patch.time !== undefined) time = patch.time;
    setContentRef?.({ settingId, dayIndex, time });
    render();
    startAutoTick();
    void pushVisibleUpdate();
  }

  function advanceDay(deltaDays) {
    persistState({ dayIndex: dayIndex + deltaDays });
  }

  // Walks month-by-month (not a fixed day count — months can have different
  // lengths), accumulating each traversed month's own day count so this
  // works correctly across year boundaries and multi-month jumps alike.
  // Clamps the resulting day-of-month to the target month's own length
  // (Jan 31 + 1 month lands on Feb 28/29, not a nonexistent Feb 31).
  function advanceMonth(deltaMonths) {
    const calendar = settingRecord?.calendar;
    if (!calendar?.months?.length) return;
    const totalMonths = calendar.months.length;
    const { monthIndex, dayOfMonth } = formatCalendarDate(calendar, dayIndex);
    let firstOfMonth = dayIndex - (dayOfMonth - 1);
    let idx = monthIndex;
    const step = deltaMonths > 0 ? 1 : -1;
    for (let i = 0; i < Math.abs(deltaMonths); i += 1) {
      if (step > 0) {
        firstOfMonth += Number(calendar.months[idx].days) || 0;
        idx = (idx + 1) % totalMonths;
      } else {
        idx = (idx - 1 + totalMonths) % totalMonths;
        firstOfMonth -= Number(calendar.months[idx].days) || 0;
      }
    }
    const targetMonthDays = Number(calendar.months[idx].days) || 1;
    persistState({ dayIndex: firstOfMonth + (Math.min(dayOfMonth, targetMonthDays) - 1) });
  }

  // Rolls over into dayIndex when minutesOfDay crosses midnight in either
  // direction, so advancing time never leaves the calendar's own date out
  // of sync with the clock.
  function advanceTime(deltaMinutes) {
    const total = time.minutesOfDay + deltaMinutes;
    const dayDelta = Math.floor(total / MINUTES_PER_DAY);
    const minutesOfDay = ((total % MINUTES_PER_DAY) + MINUTES_PER_DAY) % MINUTES_PER_DAY;
    persistState({ dayIndex: dayIndex + dayDelta, time: { ...time, minutesOfDay } });
  }

  function updateTime(patch) {
    persistState({ time: { ...time, ...patch } });
  }

  function renderTimeSection() {
    const section = el("div", "d-flex flex-column gap-2 border-top pt-2");
    const toggleWrap = el("div", "form-check form-switch mb-0");
    const toggle = document.createElement("input");
    toggle.type = "checkbox";
    toggle.className = "form-check-input";
    toggle.id = `calendar-time-${Math.random().toString(36).slice(2, 8)}`;
    toggle.checked = time.enabled;
    toggle.addEventListener("change", () => updateTime({ enabled: toggle.checked }));
    const toggleLabel = document.createElement("label");
    toggleLabel.className = "form-check-label small text-body-secondary";
    toggleLabel.htmlFor = toggle.id;
    toggleLabel.textContent = "Track time of day";
    toggleWrap.append(toggle, toggleLabel);
    section.appendChild(toggleWrap);

    if (!time.enabled) return section;

    const timeRow = el("div", "d-flex align-items-center gap-2");
    timeRow.appendChild(el("div", "fs-6 fw-semibold", formatTimeOfDay(time.minutesOfDay)));
    const minusHour = iconButton("tabler:chevron-left", "Back 1 hour");
    minusHour.addEventListener("click", () => advanceTime(-60));
    const plusHour = iconButton("tabler:chevron-right", "Forward 1 hour");
    plusHour.addEventListener("click", () => advanceTime(60));
    timeRow.append(minusHour, plusHour);
    section.appendChild(timeRow);

    const autoRow = el("div", "d-flex flex-wrap align-items-center gap-2");
    const autoCheckWrap = el("div", "form-check form-switch mb-0");
    const autoCheck = document.createElement("input");
    autoCheck.type = "checkbox";
    autoCheck.className = "form-check-input";
    autoCheck.id = `calendar-autotick-${Math.random().toString(36).slice(2, 8)}`;
    autoCheck.checked = time.autoTickEnabled;
    autoCheck.addEventListener("change", () => updateTime({ autoTickEnabled: autoCheck.checked }));
    const autoLabel = document.createElement("label");
    autoLabel.className = "form-check-label small text-body-secondary";
    autoLabel.htmlFor = autoCheck.id;
    autoLabel.textContent = "Auto";
    autoCheckWrap.append(autoCheck, autoLabel);

    const minutesInput = document.createElement("input");
    minutesInput.type = "number";
    minutesInput.min = "1";
    minutesInput.className = "form-control form-control-sm";
    minutesInput.style.width = "4.5rem";
    minutesInput.setAttribute("aria-label", "Game minutes per tick");
    minutesInput.value = String(time.autoTickMinutes);
    minutesInput.addEventListener("change", () =>
      updateTime({ autoTickMinutes: Math.max(1, Number(minutesInput.value) || 1) })
    );

    const secondsInput = document.createElement("input");
    secondsInput.type = "number";
    secondsInput.min = "1";
    secondsInput.className = "form-control form-control-sm";
    secondsInput.style.width = "4.5rem";
    secondsInput.setAttribute("aria-label", "Real seconds per tick");
    secondsInput.value = String(time.autoTickSeconds);
    secondsInput.addEventListener("change", () =>
      updateTime({ autoTickSeconds: Math.max(1, Number(secondsInput.value) || 1) })
    );

    autoRow.append(
      autoCheckWrap,
      minutesInput,
      el("span", "small text-body-secondary", "game min. every"),
      secondsInput,
      el("span", "small text-body-secondary", "real sec.")
    );
    section.appendChild(autoRow);
    return section;
  }

  function render() {
    if (destroyed) return;
    container.innerHTML = "";
    const calendar = settingRecord?.calendar;
    if (!settingId || !calendar) {
      const wrap = el("div", "d-flex flex-column gap-2");
      wrap.appendChild(
        el(
          "p",
          "text-body-secondary small mb-0",
          settingId ? "This Setting has no calendar defined — add one in Sanctum." : "No Setting picked."
        )
      );
      setTitle?.("Calendar");
      container.appendChild(wrap);
      return;
    }
    setTitle?.(settingRecord?.name ? `${settingRecord.name} Calendar` : "Calendar");

    // Two clearly separate, clearly labeled groups — double chevrons (a
    // bigger step) for Month, single chevrons for Day, plus text labels, so
    // the two are never confused for each other at a glance.
    const stepGroup = el("div", "d-flex align-items-center gap-2 flex-shrink-0");
    const monthGroup = el("div", "d-flex align-items-center gap-1");
    monthGroup.appendChild(el("span", "small text-body-secondary", "Month"));
    const minusMonth = iconButton("tabler:chevrons-left", "Back one month");
    minusMonth.addEventListener("click", () => advanceMonth(-1));
    const plusMonth = iconButton("tabler:chevrons-right", "Forward one month");
    plusMonth.addEventListener("click", () => advanceMonth(1));
    monthGroup.append(minusMonth, plusMonth);

    const dayGroup = el("div", "d-flex align-items-center gap-1");
    dayGroup.appendChild(el("span", "small text-body-secondary", "Day"));
    const minusDay = iconButton("tabler:chevron-left", "Back one day");
    minusDay.addEventListener("click", () => advanceDay(-1));
    const plusDay = iconButton("tabler:chevron-right", "Forward one day");
    plusDay.addEventListener("click", () => advanceDay(1));
    dayGroup.append(minusDay, plusDay);

    stepGroup.append(monthGroup, dayGroup);

    const wrap = el("div", "d-flex flex-column gap-2 flex-grow-1");
    wrap.style.minHeight = "0";
    wrap.style.overflowY = "auto";
    const displayHost = el("div");
    // No `time` passed here — the interactive section below is this view's
    // own, more capable replacement (display + controls), not a second,
    // redundant read-only line. onDayClick lets the GM click straight into
    // any visible day of the current month instead of stepping one at a time.
    renderCalendarView(displayHost, calendar, dayIndex, {
      headingExtra: stepGroup,
      onDayClick: (targetDayIndex) => persistState({ dayIndex: targetDayIndex }),
    });
    wrap.appendChild(displayHost);
    wrap.appendChild(renderTimeSection());
    container.appendChild(wrap);
  }

  async function boot() {
    await loadSettingRecord();
    render();
    startAutoTick();
    void refreshVisibility();
  }
  void boot();

  return {
    // `removed` is only ever true from dashboard.js's removeWidget — the
    // one moment this instance's own still-active spotlight (if any) needs
    // clearing, same orphan-prevention reasoning Clock/Browser's own
    // destroy(removed) gives (there's no Library record for the widget
    // instance itself to make this automatic).
    async destroy(removed) {
      destroyed = true;
      stopAutoTick();
      container.innerHTML = "";
      if (removed && visible && groupId && instanceId) {
        try {
          await dataManager.clearSpotlight({ groupId, kind: "calendar", id: instanceId });
        } catch (error) {
          // Best-effort cleanup — nothing meaningful to do if this fails.
        }
      }
    },
  };
}
