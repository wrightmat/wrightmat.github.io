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
// The day/time themselves, and which Setting they're read against, are NOT
// this widget's own contentRef any more — they're ambient campaign state,
// the same conceptual tier as the active Group's own systemId/settingId
// (see group-context.js's own resolveGroupContext, which this widget's
// `groupContext` param comes from, and data-manager.js's own
// setCampaignDate). Every Calendar widget on a dashboard reads/writes the
// SAME shared day/time — advancing it from one instance is reflected in
// every other one immediately (see the "undercroft:campaign-date-changed"
// event this file listens for below), not an independent running count per
// widget the way it used to be. `contentRef` now only holds this ONE
// instance's own display preferences — `{ time: { enabled, autoTickEnabled,
// autoTickSeconds, autoTickMinutes } }` — whether THIS card shows/manages
// the time-of-day section at all, not the time value itself.
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
  // See Clock's own CLOCK_MACRO_ACTIONS.create for why this one, alone
  // among these, is allowed to add a widget when none exists yet — here
  // that also means prompting for a Setting via dashboard.js's own
  // pickCalendarContentRef when there's no existing Calendar of any
  // visibility to reuse.
  create: { label: "Create new & show" },
};

// 5s — same cadence Clock/Browser's own follower/GM polls use.
const POLL_INTERVAL_MS = 5000;
const MINUTES_PER_DAY = 1440;

// Exported — repository/js/lib/journal-date.js's own `date:` reference
// chip formats against this exact same implementation, not a second copy,
// so a date reads identically whether it's this widget or a journal page
// doing the formatting. `calendar.months` must be non-empty — callers
// branch around this themselves (see describeDate) rather than pretending a
// missing month structure is "a 365-day placeholder year," which would
// just show a confusing blank month name.
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

// Which season `dayIndex` currently falls in — walked cumulatively the
// same way formatCalendarDate walks Months, just simpler (no year/weekday
// concept, only "which one"). The season cycle's own total length is all
// Seasons' own `days` summed, deliberately NOT required to equal the
// Months-based year length — a Setting author may describe seasons on a
// different cadence entirely (see sanctum/js/app.js's own renderSeasonRow).
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
        cell.setAttribute("data-bs-toggle", "tooltip");
        cell.setAttribute("data-bs-title", "Jump to this day");
        cell.addEventListener("click", () => onDayClick(grid.firstOfMonthIndex + (day - 1)));
      }
    }
    gridEl.appendChild(cell);
  });
  container.appendChild(gridEl);
}

// Read-only display — shared by the GM's own view and every follower/
// second-screen view, so the calendar always reads identically everywhere.
// `headingExtra` (the month/year-stepper buttons), `headingContent` (the
// GM's own click-to-edit Month/Year heading, see buildEditableHeading below
// — followers never get this, they keep the plain describeDate() text),
// `time` (only passed by followers — the GM's own author view renders its
// own interactive time section instead, see initCalendarWidget's own
// render()), and `onDayClick` (also author-only — followers never get a
// clickable grid) are all optional.
function renderCalendarView(container, calendar, dayIndex, { headingExtra, headingContent, time, onDayClick } = {}) {
  container.innerHTML = "";
  const wrap = el("div", "d-flex flex-column gap-2");
  // NOT flex-wrap on this row — the stepper buttons (headingExtra) need to
  // stay pinned in place always, including the moment an edit control
  // (buildEditableHeading's own <select>/<input>) appears and the date
  // text's own natural width grows; wrapping the whole ROW to a second line
  // at that moment was moving the buttons out from under the pointer.
  // Instead the date text itself is the one that flexes/shrinks (flex-grow,
  // min-width: 0 below) — its OWN internal flex-wrap (buildEditableHeading's
  // own `heading` div) still lets IT wrap onto a second line on a narrow
  // card, which is the piece that can afford to.
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

// The GM's own click-to-edit date heading — "Weekday, Day Month, Year
// Epoch" as separate DOM pieces (not describeDate's own single string) so
// Month/Year can each be clicked into an editable control: a <select> for
// Month (jump to that month, same day-of-month, current year — onSetMonth),
// a number <input> for Year (jump to the same month/day in that year —
// onSetYear). Both start, and end, as plain inline text — "hidden until
// clicked," not a pair of permanently-visible form controls — swapping back
// after a commit (change/Enter) or an abandoned edit (blur with no change).
// Falls back to plain describeDate() text when the calendar has no months
// at all — there's no month list to build a <select> from, and no reliable
// "days per year" figure to shift Year by either.
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
    // text-decoration, not border-bottom — a border sits inside the inline
    // box's own layout (padding/height), which nudged this span (and with
    // it, the whole text line it's part of) up slightly compared to plain
    // text next to it. text-decoration is pure paint, never affects layout
    // or line height, so the line stays straight either way.
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
  // those add a border, background, and (for select) a chevron/padding
  // that's a lot of extra width for an inline heading to absorb, which is
  // exactly what was pushing the Year control (and the stepper buttons
  // beside it) onto a second line. Sized/colored to blend into the
  // surrounding heading text instead ("hidden until clicked" extends to
  // "unobtrusive once clicked into", not just before).
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

// No more `minutesOfDay` here — that's the ambient value now (this
// widget's own `minutesOfDay` variable, sourced from groupContext/the
// campaign-date-changed event), not a per-instance display preference.
function normalizeTime(raw) {
  return {
    enabled: Boolean(raw?.enabled),
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
    // Whatever dashboard.js already resolved via resolveGroupContext for
    // this render pass — read once at mount for settingId/the initial
    // day/time (a Setting reassignment triggers dashboard.js's own full
    // rebuild via workbench:active-group-changed, same as every other
    // groupContext-driven widget, so this never needs to re-resolve
    // mid-lifetime); day/time themselves stay live afterward via the
    // campaign-date-changed event below, not by re-reading this object.
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

  // Same reasoning Clock's own header comment gives for its forcePlayerView
  // branch: the second-screen mirror is a fully separate JS context (a real
  // window.open, not shared page state), so treating it as a follower OF
  // ITSELF — reading back whatever toggleVisibility already broadcasts — is
  // what makes it a live view instead of one static snapshot at mount time.
  if (forcePlayerView && instanceId) {
    return initFollowerCalendar(container, { dataManager, groupId, shareToken, followId: instanceId, setTitle });
  }

  // The campaign's own ambient Setting/day/time (see this file's own header
  // comment) — settingId is fixed for this instance's lifetime (reassigning
  // the campaign's Setting rebuilds the whole dashboard); dayIndex/
  // minutesOfDay stay live via handleCampaignDateChanged below, updated
  // either by THIS instance's own writes or another instance's/another
  // tab's.
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

  // Keeps a follower's next poll current with the day/time — called after
  // every change while this instance is the one currently visible. A plain
  // spotlight-update (not a fresh `spotlight` entry), same reasoning
  // Clock's own pushVisibleUpdate gives: a fresh `spotlight` would
  // re-trigger every other viewer's accept-prompt/Game Log row on every
  // single day/time advance.
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
  // immediately off the local variables, same responsiveness the old
  // purely-local contentRef write had) with the actual server write and its
  // own cross-instance broadcast (data-manager.js's own
  // "undercroft:campaign-date-changed" event, see handleCampaignDateChanged
  // below) following in the background — a failure just leaves a toast, the
  // next successful write (or another instance's own) will still catch this
  // one up.
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

  // The per-instance display-preference write (whether this card shows/
  // auto-ticks time at all) — local to this widget, same shape/mechanism
  // every other widget's own contentRef write already uses.
  function persistTimeConfig(patch) {
    time = { ...time, ...patch };
    setContentRef?.({ time });
    render();
    startAutoTick();
  }

  function advanceDay(deltaDays) {
    persistDate({ dayIndex: dayIndex + deltaDays });
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
    persistDate({ dayIndex: firstOfMonth + (Math.min(dayOfMonth, targetMonthDays) - 1) });
  }

  // Shifts by whole years — the same month/day-of-month, `deltaYears` years
  // later (or earlier). Replaces the old Day stepper's own single-arrow
  // buttons in the toolbar (see render() below) — clicking any visible day
  // in the month grid already jumps straight to it, so a day-by-day stepper
  // was redundant; a year-by-year one wasn't available at all before. Also
  // what the editable Year heading (buildEditableHeading's own onSetYear)
  // computes its jump through, via setYear just below.
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

  // Rolls over into dayIndex when minutesOfDay crosses midnight in either
  // direction, so advancing time never leaves the calendar's own date out
  // of sync with the clock. Both land in the same persistDate call (one
  // ambient write), not two — a day-crossing time advance is never visible
  // to another reader half-updated.
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
  // Same reasoning as Clock's own runMacroAction: no portable target, only
  // "whichever calendar is currently shown" (dashboard.js's
  // findActiveWidgetInstance, driven by isVisible() below).
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
    // Disposed before the wipe, not just left to be garbage-collected — see
    // BUG CLASS 2 in tooltips.js's own header comment for why the ordering
    // matters (the month/year stepper buttons and the click-to-edit
    // month/year heading below all carry real tooltips now).
    disposeTooltips(container);
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

    // Two clearly separate, clearly labeled groups — double chevrons (a
    // bigger step) for Month, single chevrons for Year, plus text labels, so
    // the two are never confused for each other at a glance. Year replaces
    // the old Day stepper here — a day-by-day stepper was redundant with
    // clicking any visible day in the month grid below (onDayClick), and a
    // year-by-year jump wasn't available anywhere before this.
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
    // No `time` passed here — the interactive section below is this view's
    // own, more capable replacement (display + controls), not a second,
    // redundant read-only line. onDayClick lets the GM click straight into
    // any visible day of the current month instead of stepping one at a time.
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

  // Keeps this instance's own day/time mirror current with whatever ANY
  // Calendar widget — this one, another instance on the same dashboard, or
  // another of the GM's own tabs — just wrote via setCampaignDate, without
  // needing this instance to re-fetch or re-resolve anything: the event
  // already carries the new values. Filtered to this widget's own campaign
  // (a GM could in principle have widgets from more than one group's own
  // history mounted at once, though not simultaneously visible in
  // practice) so an unrelated campaign's own date change is ignored.
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
    // `removed` is only ever true from dashboard.js's removeWidget — the
    // one moment this instance's own still-active spotlight (if any) needs
    // clearing, same orphan-prevention reasoning Clock/Browser's own
    // destroy(removed) gives (there's no Library record for the widget
    // instance itself to make this automatic).
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
