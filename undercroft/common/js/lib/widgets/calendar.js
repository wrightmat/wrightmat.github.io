// Tracks "what day is it" (and optionally "what time is it") against a
// Setting's own optional calendar vocabulary (months, weekday names, moon
// cycles — authored in Sanctum). Unlike Clock, this widget references a
// REAL Library record (the Setting) a follower needs read access to — so
// showing it to the table is a hybrid: Handout/Map's own record-sharing
// step (grants access to the Setting) plus Clock/Browser's inline-
// spotlight-data step (the widget instance itself has no Library record,
// just a running day/time).
//
// The day/time, and which Setting they're read against, are NOT this
// widget's own contentRef — they're ambient campaign state, the same tier
// as the active Group's own systemId/settingId (group-context.js's
// resolveGroupContext; data-manager.js's setCampaignDate). Every Calendar
// widget on a dashboard reads/writes the SAME shared day/time — advancing
// it from one instance reflects in every other immediately (the
// "undercroft:campaign-date-changed" event below). `contentRef` only holds
// this ONE instance's own display preferences — `{ time: { enabled,
// autoTickEnabled, autoTickSeconds, autoTickMinutes } }`.
import { el } from "../dom.js";
import { connectLiveStream } from "../live.js";
import { resolveIsSpotlighted, resolveSpotlightData } from "../spotlight.js";
import { createReliableInterval } from "../reliable-interval.js";
import { disposeTooltips, refreshTooltips } from "../tooltips.js";

// --- Macro action support (common/js/lib/widgets/macro-runner.js) --------
// Same "active only, no portable target" story as Clock's own
// CLOCK_MACRO_ACTIONS — see that file's comment for why.
export const CALENDAR_MACRO_ACTIONS = {
  show: { label: "Show to table" },
  hide: { label: "Hide from table" },
  advanceDay: { label: "Advance / retreat days", params: ["delta"] },
  advanceTime: { label: "Advance / retreat minutes", params: ["minutes"] },
  // Alone among these, allowed to add a widget when none exists yet — also prompts for a Setting if none to reuse.
  create: { label: "Create new & show" },
};

// 5s — same cadence Clock/Browser's own follower/GM polls use.
const POLL_INTERVAL_MS = 5000;
const MINUTES_PER_DAY = 1440;

// Exported — journal-date.js's `date:` chip formats against this exact
// implementation, not a second copy. `calendar.months` must be non-empty —
// callers branch around this (see describeDate) rather than treating a
// missing month structure as a placeholder year.
export function formatCalendarDate(calendar, dayIndex) {
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

// Which season `dayIndex` falls in — walked cumulatively like
// formatCalendarDate walks Months. The season cycle's total length
// (Seasons' `days` summed) is deliberately NOT required to equal the
// Months-based year length — a Setting author may describe seasons on a different cadence.
function formatSeason(seasons, dayIndex) {
  const list = Array.isArray(seasons) ? seasons : [];
  const totalDays = list.reduce((sum, season) => sum + (Number(season.days) || 0), 0);
  if (totalDays <= 0) return "";
  let remaining = ((dayIndex % totalDays) + totalDays) % totalDays;
  for (const season of list) {
    const days = Number(season.days) || 0;
    if (remaining < days) return season.name || "";
    remaining -= days;
  }
  return list[list.length - 1]?.name || "";
}

// Exported for the same reason formatCalendarDate is — journal-date.js's
// own `date:` chip reuses this directly.
export function describeDate(calendar, dayIndex) {
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

// Exported for the same reason formatCalendarDate is.
export function formatTimeOfDay(minutesOfDay) {
  const raw = Number(minutesOfDay) || 0;
  const total = ((raw % MINUTES_PER_DAY) + MINUTES_PER_DAY) % MINUTES_PER_DAY;
  const hours = Math.floor(total / 60);
  const minutes = total % 60;
  return `${String(hours).padStart(2, "0")}:${String(minutes).padStart(2, "0")}`;
}

// Every cell for the CURRENT month, in weekday-column order — `null` for
// leading blanks before day 1. Requires `months` and `daysPerWeek`; returns
// null otherwise so the caller falls back to plain date text.
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

// `onDayClick(targetDayIndex)` — optional, omitted for read-only views.
// Passed the absolute dayIndex, not a bare day-of-month, so the caller never re-derives it.
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
        cell.setAttribute("data-bs-toggle", "tooltip");
        cell.setAttribute("data-bs-title", "Jump to this day");
        cell.addEventListener("click", () => onDayClick(grid.firstOfMonthIndex + (day - 1)));
      }
    }
    gridEl.appendChild(cell);
  });
  container.appendChild(gridEl);
}

// Read-only display shared by the GM's own view and every follower/second-
// screen view. `headingExtra` (stepper buttons), `headingContent` (the GM's
// click-to-edit heading — followers keep plain describeDate() text),
// `time` (followers only — the author view renders its own interactive
// time section), and `onDayClick` (author-only) are all optional.
function renderCalendarView(container, calendar, dayIndex, { headingExtra, headingContent, time, onDayClick } = {}) {
  container.innerHTML = "";
  const wrap = el("div", "d-flex flex-column gap-2");
  // NOT flex-wrap — the stepper buttons must stay pinned even as an edit
  // control widens the date text; the date text itself flexes/shrinks
  // instead (flex-grow, min-width: 0 below), and its own internal wrap can
  // still drop to a second line on a narrow card.
  const headingRow = el("div", "d-flex align-items-center justify-content-between gap-2 flex-nowrap");
  const headingNode = headingContent || el("div", "fw-semibold", describeDate(calendar, dayIndex));
  headingNode.style.flex = "1 1 auto";
  headingNode.style.minWidth = "0";
  headingRow.appendChild(headingNode);
  if (headingExtra) headingRow.appendChild(headingExtra);
  wrap.appendChild(headingRow);

  const gridHost = document.createElement("div");
  renderMonthGrid(gridHost, calendar, dayIndex, onDayClick);
  if (gridHost.childNodes.length) wrap.appendChild(gridHost);

  if (calendar.moonCycles?.length) {
    const moonLine = calendar.moonCycles.map((cycle) => `${cycle.name}: ${formatMoonPhase(cycle, dayIndex)}`).join(" · ");
    wrap.appendChild(el("div", "small text-body-secondary", moonLine));
  }

  if (calendar.seasons?.length) {
    const seasonName = formatSeason(calendar.seasons, dayIndex);
    if (seasonName) wrap.appendChild(el("div", "small text-body-secondary", seasonName));
  }

  if (time?.enabled) {
    wrap.appendChild(el("div", "small", formatTimeOfDay(time.minutesOfDay)));
  }

  container.appendChild(wrap);
}

// The GM's click-to-edit date heading — "Weekday, Day Month, Year Epoch" as
// separate DOM pieces so Month/Year can each be clicked into an editable
// control (a <select> for Month via onSetMonth, a number <input> for Year
// via onSetYear). Both start and end as plain inline text, swapping back on
// commit or an abandoned edit. Falls back to plain describeDate() text when
// the calendar has no months at all.
function buildEditableHeading(calendar, dayIndex, { onSetMonth, onSetYear }) {
  const months = calendar?.months || [];
  const heading = el("div", "fw-semibold d-flex align-items-center flex-wrap");
  heading.style.gap = "0.2rem";
  if (!months.length) {
    heading.textContent = describeDate(calendar, dayIndex);
    return heading;
  }
  const epoch = calendar?.epochLabel ? ` ${calendar.epochLabel}` : "";
  const { year, monthIndex, monthName, dayOfMonth, weekdayName } = formatCalendarDate(calendar, dayIndex);

  function styleEditableField(span) {
    span.style.cursor = "pointer";
    // text-decoration, not border-bottom — a border affects layout/line height, text-decoration is pure paint.
    span.style.textDecorationLine = "underline";
    span.style.textDecorationStyle = "dashed";
    span.style.textDecorationColor = "var(--bs-secondary-color, #6c757d)";
    span.style.textUnderlineOffset = "2px";
  }

  if (weekdayName) heading.appendChild(document.createTextNode(`${weekdayName}, `));
  heading.appendChild(document.createTextNode(`${dayOfMonth} `));

  const monthSpan = el("span", "");
  monthSpan.textContent = monthName;
  monthSpan.setAttribute("data-bs-toggle", "tooltip");
  monthSpan.setAttribute("data-bs-title", "Click to change month");
  styleEditableField(monthSpan);
  // Plain unstyled controls, not Bootstrap's form-select/form-control-sm —
  // those add enough width to push the Year control and stepper buttons onto a second line.
  function styleInlineControl(control) {
    control.style.border = "none";
    control.style.background = "transparent";
    control.style.padding = "0";
    control.style.font = "inherit";
    control.style.color = "inherit";
    control.style.outline = "none";
    control.style.cursor = "pointer";
  }

  monthSpan.addEventListener("click", () => {
    const select = document.createElement("select");
    select.className = "d-inline-block";
    styleInlineControl(select);
    select.style.maxWidth = "9rem";
    months.forEach((month, index) => {
      const option = new Option(month.name || `Month ${index + 1}`, String(index));
      if (index === monthIndex) option.selected = true;
      select.appendChild(option);
    });
    monthSpan.replaceWith(select);
    select.focus();
    select.addEventListener("change", () => onSetMonth(Number(select.value)));
    select.addEventListener(
      "blur",
      () => {
        if (select.isConnected) select.replaceWith(monthSpan);
      },
      { once: true }
    );
  });
  heading.appendChild(monthSpan);
  heading.appendChild(document.createTextNode(", "));

  const yearSpan = el("span", "");
  yearSpan.textContent = String(year);
  yearSpan.setAttribute("data-bs-toggle", "tooltip");
  yearSpan.setAttribute("data-bs-title", "Click to change year");
  styleEditableField(yearSpan);
  yearSpan.addEventListener("click", () => {
    const input = document.createElement("input");
    input.type = "number";
    input.className = "d-inline-block";
    styleInlineControl(input);
    input.style.width = `${String(year).length + 2}ch`;
    input.value = String(year);
    input.addEventListener("input", () => {
      input.style.width = `${Math.max(String(input.value).length, String(year).length) + 2}ch`;
    });
    yearSpan.replaceWith(input);
    input.focus();
    input.select();
    const commit = () => {
      const next = Number(input.value);
      if (Number.isFinite(next) && next !== year) onSetYear(next);
    };
    input.addEventListener("change", commit);
    input.addEventListener("keydown", (event) => {
      if (event.key === "Enter") input.blur();
    });
    input.addEventListener(
      "blur",
      () => {
        if (input.isConnected) input.replaceWith(yearSpan);
      },
      { once: true }
    );
  });
  heading.appendChild(yearSpan);
  if (epoch) heading.appendChild(document.createTextNode(epoch));
  return heading;
}

function renderFollowerEmpty(container) {
  container.innerHTML = "";
  container.appendChild(el("p", "text-body-secondary small mb-0", "The GM isn't showing this calendar right now."));
}

// contentRef.followKind === "calendar" marks a follower instance — created
// by acceptSpotlight when a player accepts a GM's calendar spotlight, or by
// the forcePlayerView self-follow branch below for the second-screen
// mirror. Reads day/time from the spotlight entry's inline data, then
// fetches the referenced Setting (readable via toggleVisibility's share
// grant) purely for its `.calendar` vocabulary.
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
  pollTimer = createReliableInterval(() => void refresh(), POLL_INTERVAL_MS);
  // The group log is the one live channel every inline-kind follower watches — matches Clock/Browser's own followers.
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

// No `minutesOfDay` here — that's the ambient value now (sourced from groupContext/the campaign-date-changed event).
function normalizeTime(raw) {
  return {
    enabled: Boolean(raw?.enabled),
    // autoTickMinutes: how much game time each tick advances, so a GM can set e.g. "6 real sec = 1 game min".
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
  // Bootstrap's spacing scale jumps from p-0 to p-1; finer than either since these are icon-only steppers.
  button.style.padding = "0.1rem 0.4rem";
  button.appendChild(icon(name));
  button.setAttribute("aria-label", title);
  button.setAttribute("data-bs-toggle", "tooltip");
  button.setAttribute("data-bs-title", title);
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
    // Read once at mount for settingId/the initial day/time — a Setting
    // reassignment triggers dashboard.js's own full rebuild, so this never
    // re-resolves mid-lifetime; day/time stay live via the campaign-date-changed event below.
    groupContext,
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

  // The second-screen mirror is a separate JS context (a real window.open),
  // so treating it as a follower of itself keeps it live instead of a static snapshot.
  if (forcePlayerView && instanceId) {
    return initFollowerCalendar(container, { dataManager, groupId, shareToken, followId: instanceId, setTitle });
  }

  // The campaign's ambient Setting/day/time — settingId is fixed for this
  // instance's lifetime; dayIndex/minutesOfDay stay live via handleCampaignDateChanged below.
  const settingId = groupContext?.settingId || "";
  let dayIndex = Number(groupContext?.campaignDayIndex) || 0;
  let minutesOfDay = Number(groupContext?.campaignMinutesOfDay) || 0;
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

  // A plain spotlight-update, not a fresh `spotlight` entry — that would
  // re-trigger every viewer's accept-prompt/Game Log row on every day/time advance.
  async function pushVisibleUpdate() {
    if (!visible || !instanceId || !groupId) return;
    try {
      await dataManager.updateSpotlightData({
        groupId,
        kind: "calendar",
        id: instanceId,
        data: { settingId, dayIndex, time: { ...time, minutesOfDay } },
      });
    } catch (error) {
      // Best-effort — a follower just won't see this particular change yet.
    }
  }

  async function toggleVisibility() {
    if (!groupId || !instanceId) {
      status?.show("No active campaign to show this to.", { type: "warning", timeout: 2500 });
      return;
    }
    if (!settingId) {
      status?.show("This campaign has no Setting assigned yet — nothing to show.", { type: "warning", timeout: 2500 });
      return;
    }
    try {
      if (visible) {
        await dataManager.clearSpotlight({ groupId, kind: "calendar", id: instanceId });
        status?.show("Stopped showing to the table.", { type: "success", timeout: 2000 });
      } else {
        // Grants read access to the Setting — the spotlight entry itself
        // carries no Library record (skipShare:true), only day/time; a
        // follower needs this separate grant to fetch `.calendar`.
        await dataManager.shareWithGroup({ contentType: "setting", contentId: settingId, groupId, permissions: "view" });
        await dataManager.spotlightToGroup({
          groupId,
          contentType: "calendar",
          contentId: instanceId,
          skipShare: true,
          data: { settingId, dayIndex, time: { ...time, minutesOfDay } },
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

  // The ambient write — day and/or minutesOfDay. Optimistic (renders
  // immediately off local variables) with the server write and its
  // cross-instance broadcast following in the background — a failure just
  // leaves a toast; the next successful write catches this one up.
  function persistDate(patch) {
    if (patch.dayIndex !== undefined) dayIndex = patch.dayIndex;
    if (patch.minutesOfDay !== undefined) minutesOfDay = patch.minutesOfDay;
    render();
    startAutoTick();
    void pushVisibleUpdate();
    void dataManager.setCampaignDate(groupId, { dayIndex, minutesOfDay }).catch((error) => {
      status?.show(error?.message || "Unable to update the campaign date.", { type: "error" });
    });
  }

  // The per-instance display-preference write (whether this card shows/auto-ticks time), local to this widget.
  function persistTimeConfig(patch) {
    time = { ...time, ...patch };
    setContentRef?.({ time });
    render();
    startAutoTick();
  }

  function advanceDay(deltaDays) {
    persistDate({ dayIndex: dayIndex + deltaDays });
  }

  // Walks month-by-month (months can have different lengths), so this works
  // across year boundaries. Clamps the result to the target month's own
  // length (Jan 31 + 1 month lands on Feb 28/29, not a nonexistent Feb 31).
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
    persistDate({ dayIndex: firstOfMonth + (Math.min(dayOfMonth, targetMonthDays) - 1) });
  }

  // Shifts by whole years — the same month/day-of-month, `deltaYears` years
  // later. Replaces the old single-day stepper (redundant with clicking any
  // visible day in the month grid). Also what the editable Year heading's onSetYear jumps through via setYear.
  function advanceYear(deltaYears) {
    const calendar = settingRecord?.calendar;
    if (!calendar?.months?.length || !deltaYears) return;
    const totalDays = calendar.months.reduce((sum, month) => sum + (Number(month.days) || 0), 0) || 1;
    persistDate({ dayIndex: dayIndex + deltaYears * totalDays });
  }

  function setMonth(targetMonthIndex) {
    const calendar = settingRecord?.calendar;
    if (!calendar?.months?.length) return;
    const { monthIndex } = formatCalendarDate(calendar, dayIndex);
    advanceMonth(targetMonthIndex - monthIndex);
  }

  function setYear(targetYear) {
    const calendar = settingRecord?.calendar;
    if (!calendar?.months?.length) return;
    const { year } = formatCalendarDate(calendar, dayIndex);
    advanceYear(targetYear - year);
  }

  // Rolls into dayIndex when minutesOfDay crosses midnight. Both land in one
  // persistDate call — a day-crossing time advance is never visible to another reader half-updated.
  function advanceTime(deltaMinutes) {
    const total = minutesOfDay + deltaMinutes;
    const dayDelta = Math.floor(total / MINUTES_PER_DAY);
    const nextMinutesOfDay = ((total % MINUTES_PER_DAY) + MINUTES_PER_DAY) % MINUTES_PER_DAY;
    persistDate({ dayIndex: dayIndex + dayDelta, minutesOfDay: nextMinutesOfDay });
  }

  function updateTime(patch) {
    persistTimeConfig(patch);
  }

  // --- Macro action support (common/js/lib/widgets/macro-runner.js) ---
  // No portable target, only "whichever calendar is currently shown" (dashboard.js's findActiveWidgetInstance).
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
    if (action?.action === "advanceDay") {
      advanceDay(Number(params.delta ?? 1) || 1);
      return;
    }
    if (action?.action === "advanceTime") {
      advanceTime(Number(params.minutes ?? 60) || 60);
      return;
    }
    throw new Error(`Unknown Calendar macro action "${action?.action}".`);
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
    timeRow.appendChild(el("div", "fs-6 fw-semibold", formatTimeOfDay(minutesOfDay)));
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
    disposeTooltips(container); // before the wipe — see tooltips.js's own header comment on why the ordering matters
    container.innerHTML = "";
    const calendar = settingRecord?.calendar;
    if (!settingId || !calendar) {
      const wrap = el("div", "d-flex flex-column gap-2");
      wrap.appendChild(
        el(
          "p",
          "text-body-secondary small mb-0",
          settingId
            ? "This Setting has no calendar defined — add one in Sanctum."
            : "This campaign has no Setting assigned yet — assign one to use the Calendar widget."
        )
      );
      setTitle?.("Calendar");
      container.appendChild(wrap);
      return;
    }
    setTitle?.(settingRecord?.name ? `${settingRecord.name} Calendar` : "Calendar");

    // Double chevrons for Month, single chevrons for Year, plus text labels, so the two are never confused.
    const stepGroup = el("div", "d-flex align-items-center gap-2 flex-shrink-0");
    const monthGroup = el("div", "d-flex align-items-center gap-1");
    monthGroup.appendChild(el("span", "small text-body-secondary", "Month"));
    const minusMonth = iconButton("tabler:chevrons-left", "Back one month");
    minusMonth.addEventListener("click", () => advanceMonth(-1));
    const plusMonth = iconButton("tabler:chevrons-right", "Forward one month");
    plusMonth.addEventListener("click", () => advanceMonth(1));
    monthGroup.append(minusMonth, plusMonth);

    const yearGroup = el("div", "d-flex align-items-center gap-1");
    yearGroup.appendChild(el("span", "small text-body-secondary", "Year"));
    const minusYear = iconButton("tabler:chevron-left", "Back one year");
    minusYear.addEventListener("click", () => advanceYear(-1));
    const plusYear = iconButton("tabler:chevron-right", "Forward one year");
    plusYear.addEventListener("click", () => advanceYear(1));
    yearGroup.append(minusYear, plusYear);

    stepGroup.append(monthGroup, yearGroup);

    const wrap = el("div", "d-flex flex-column gap-2 flex-grow-1");
    wrap.style.minHeight = "0";
    wrap.style.overflowY = "auto";
    const displayHost = el("div");
    // No `time` passed — the interactive section below is a more capable
    // replacement, not a redundant read-only line. onDayClick jumps straight to any visible day.
    renderCalendarView(displayHost, calendar, dayIndex, {
      headingExtra: stepGroup,
      headingContent: buildEditableHeading(calendar, dayIndex, { onSetMonth: setMonth, onSetYear: setYear }),
      onDayClick: (targetDayIndex) => persistDate({ dayIndex: targetDayIndex }),
    });
    wrap.appendChild(displayHost);
    wrap.appendChild(renderTimeSection());
    container.appendChild(wrap);
    refreshTooltips(container);
  }

  // Keeps this instance's day/time mirror current with whatever ANY
  // Calendar widget just wrote via setCampaignDate — the event already
  // carries the new values. Filtered to this widget's own campaign.
  function handleCampaignDateChanged(event) {
    if (destroyed || event.detail?.groupId !== groupId) return;
    if (event.detail?.dayIndex !== undefined) dayIndex = Number(event.detail.dayIndex) || 0;
    if (event.detail?.minutesOfDay !== undefined) minutesOfDay = Number(event.detail.minutesOfDay) || 0;
    render();
  }

  async function boot() {
    await loadSettingRecord();
    render();
    startAutoTick();
    void refreshVisibility();
  }
  void boot();
  window.addEventListener("undercroft:campaign-date-changed", handleCampaignDateChanged);

  return {
    runMacroAction,
    isVisible: () => visible,
    // `removed` is only true from dashboard.js's removeWidget — the one
    // moment this instance's still-active spotlight needs clearing (no
    // Library record exists to make this automatic).
    async destroy(removed) {
      destroyed = true;
      stopAutoTick();
      window.removeEventListener("undercroft:campaign-date-changed", handleCampaignDateChanged);
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
