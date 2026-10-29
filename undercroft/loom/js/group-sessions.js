// Loom Groups tab — the Sessions subsection: scheduled real-world game
// sessions for the selected Campaign Group. The center holds the list
// (Upcoming | History); selecting a row opens the Session Inspector in the
// right pane, the same select-then-edit shape the group's Property Inspector
// uses. Every time is UTC on the wire and local on screen. Starting values in
// the form markup are just that — whatever is saved becomes that session's
// own settings, and the server has no defaults of its own.
import { el, setElementVisible } from "../../common/js/lib/dom.js";
import {
  createCollapsibleSection,
  createIconButton,
  createListRow,
  createModeToggleGroup,
} from "../../common/js/lib/ui-components.js";
import { showConfirmModal } from "../../common/js/lib/confirm-modal.js";
import { fetchKindEntrySummaries } from "../../common/js/lib/content-fetch.js";
import { disposeTooltips, refreshTooltips } from "../../common/js/lib/tooltips.js";
import { initHelpSystem } from "../../common/js/lib/help.js";
import { parseTimestamp } from "../../common/js/lib/chat/format.js";
import { formatCalendarDate } from "../../common/js/lib/widgets/calendar.js";
import {
  localDateToUtc,
  localInputToUtc,
  localWeekdaysToUtc,
  localZoneName,
  utcToLocalDate,
  utcToLocalInput,
  utcWeekdaysToLocal,
} from "../../common/js/lib/sessions/local.js";
import {
  RESPONSE_LABELS,
  describeDuration,
  describeRecurrence,
  formatSessionRange,
} from "../../common/js/lib/sessions/format.js";

const WEEKDAYS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
const PREVIEW_COUNT = 5;
const PREVIEW_DELAY_MS = 400;

// --- small form helpers ----------------------------------------------------------------

function control(tag, attrs = {}, className = "form-control form-control-sm") {
  const node = el(tag, tag === "select" ? "form-select form-select-sm" : className);
  Object.entries(attrs).forEach(([key, value]) => {
    if (value === false || value == null) return;
    if (key === "value") node.value = value;
    else node.setAttribute(key, value === true ? "" : String(value));
  });
  return node;
}

function select(options, value) {
  const node = control("select");
  options.forEach(([optionValue, label]) => {
    const option = el("option", null, label);
    option.value = optionValue;
    node.appendChild(option);
  });
  if (value != null) node.value = value;
  return node;
}

function field(label, node, className = "") {
  const wrap = el("div", `d-flex flex-column gap-1 ${className}`.trim());
  wrap.append(el("label", "form-label small text-body-secondary fw-semibold mb-0", label), node);
  return wrap;
}

function checkbox(label, checked) {
  const wrap = el("label", "form-check small d-flex align-items-center gap-2 mb-0");
  const box = el("input", "form-check-input mt-0");
  box.type = "checkbox";
  box.checked = Boolean(checked);
  wrap.append(box, el("span", "form-check-label", label));
  return { wrap, box };
}

function heading(text) {
  return el("h3", "fs-6 fw-semibold text-body-secondary mb-0 mt-1", text);
}

function badge(text, variant = "secondary") {
  return el("span", `badge text-bg-${variant}`, text);
}

function intOrNull(node, name, { min = 0 } = {}) {
  const raw = node.value.trim();
  if (!raw) return null;
  const value = Number(raw);
  if (!Number.isInteger(value) || value < min) throw new Error(`${name} must be a whole number of at least ${min}, or empty.`);
  return value;
}

function requiredInt(node, name, { min = 0 } = {}) {
  const value = intOrNull(node, name, { min });
  if (value === null) throw new Error(`${name} is required.`);
  return value;
}

const minutesToHours = (minutes) => (minutes === null || minutes === undefined ? "" : String(minutes / 60));

// --- the series form -----------------------------------------------------------------------

// `initial` is a serialized series (or null for a new one). Starting values are
// plain attributes here; the form's read() returns every setting explicitly.
function buildSeriesForm({ initial, threads, onChange, showRepeat = true }) {
  const root = el("div", "d-flex flex-column gap-2");
  const startUtc = initial?.startAt ? new Date(`${initial.startAt}Z`).toISOString() : "";
  const isPbp = initial?.kind === "pbp";

  const title = control("input", { type: "text", maxlength: 200, value: initial?.title || "" });
  const description = control("textarea", { rows: 3, value: initial?.description || "" });
  const kind = select([["live", "Live game"], ["pbp", "Play-by-post"]], initial?.kind || "live");

  const liveStart = control("input", { type: "datetime-local", value: initial && !isPbp ? utcToLocalInput(initial.startAt) : "" });
  const duration = control("input", { type: "number", min: 1, value: initial && !isPbp ? initial.durationMinutes : 180 });
  const pbpStart = control("input", { type: "date", value: initial && isPbp ? utcToLocalDate(initial.startAt) : "" });
  const endIso = initial ? new Date(new Date(`${initial.startAt}Z`).getTime() + initial.durationMinutes * 60000 - 1000).toISOString() : "";
  const pbpEnd = control("input", { type: "date", value: initial && isPbp ? utcToLocalDate(endIso) : "" });

  const repeat = select([["", "Does not repeat"], ["daily", "Daily"], ["weekly", "Weekly"], ["monthly", "Monthly"]], initial?.recurrence?.freq || "");
  const interval = control("input", { type: "number", min: 1, value: initial?.recurrence?.interval ?? 1 });
  const weekdayBoxes = WEEKDAYS.map((name) => checkbox(name, false));
  const monthly = select([["dayOfMonth", "Same date each month"], ["nthWeekday", "Same weekday each month"]], initial?.recurrence?.monthly || "dayOfMonth");
  const endType = select([["never", "Never"], ["until", "On a date"], ["count", "After a number of times"]], initial?.recurrence?.end?.type || "never");
  const until = control("input", { type: "date", value: initial?.recurrence?.end?.until ? utcToLocalDate(initial.recurrence.end.until) : "" });
  const count = control("input", { type: "number", min: 1, value: initial?.recurrence?.end?.count ?? 10 });
  const preview = el("div", "small text-body-secondary");

  const locationText = control("input", { type: "text", value: initial?.locationText || "" });
  const locationUrl = control("input", { type: "url", placeholder: "https://", value: initial?.locationUrl || "" });
  const minPlayers = control("input", { type: "number", min: 0, value: initial?.minPlayers ?? "" });
  const maxPlayers = control("input", { type: "number", min: 0, value: initial?.maxPlayers ?? "" });
  const cutoff = control("input", { type: "number", min: 0, step: "any", value: initial ? minutesToHours(initial.rsvpCutoffMinutes) : "" });
  const late = checkbox("Allow RSVPs after the cutoff", initial?.allowLateRsvp ?? false);
  const lead = control("input", { type: "number", min: 0, value: initial?.leadDays ?? 14 });
  const reminder = control("input", { type: "number", min: 0, step: "any", value: initial ? minutesToHours(initial.reminderMinutes) : 24 });
  const reminderLabel = el("label", "form-label small text-body-secondary fw-semibold mb-0");
  const lock = checkbox("Lock posting in linked threads outside the session window", initial?.lockPosting ?? false);

  const threadBoxes = threads.map((thread) => ({ id: thread.id, ...checkbox(thread.label, (initial?.threadIds || []).includes(thread.id)) }));

  const liveRow = el("div", "row g-2");
  liveRow.append(
    ...[field("Starts", liveStart), field("Duration (minutes)", duration)].map((node) => {
      const col = el("div", "col-12 col-md-6");
      col.appendChild(node);
      return col;
    })
  );
  const pbpRow = el("div", "row g-2");
  pbpRow.append(
    ...[field("Window opens", pbpStart), field("Window closes", pbpEnd)].map((node) => {
      const col = el("div", "col-12 col-md-6");
      col.appendChild(node);
      return col;
    })
  );

  if (initial?.recurrence?.freq === "weekly" && startUtc) {
    utcWeekdaysToLocal(startUtc, initial.recurrence.byWeekday || []).forEach((day) => (weekdayBoxes[day].box.checked = true));
  }

  const weekdayRow = el("div", "d-flex flex-wrap gap-3");
  weekdayBoxes.forEach((entry) => weekdayRow.appendChild(entry.wrap));
  const repeatDetails = el("div", "d-flex flex-column gap-2");
  const intervalRow = el("div", "row g-2");
  [field("Every", interval), field("Ends", endType)].forEach((node) => {
    const col = el("div", "col-6");
    col.appendChild(node);
    intervalRow.appendChild(col);
  });
  const weekdayField = field("On", weekdayRow);
  const monthlyField = field("Pattern", monthly);
  const untilField = field("Until", until);
  const countField = field("Number of times", count);
  repeatDetails.append(intervalRow, weekdayField, monthlyField, untilField, countField);

  function startMoment() {
    return kind.value === "pbp" ? localDateToUtc(pbpStart.value) : localInputToUtc(liveStart.value);
  }

  function durationMinutes() {
    if (kind.value !== "pbp") return requiredInt(duration, "Duration", { min: 1 });
    const from = localDateToUtc(pbpStart.value);
    const to = localDateToUtc(pbpEnd.value, { endOfDay: true });
    if (!from || !to) throw new Error("Choose when the window opens and closes.");
    const minutes = Math.round((new Date(to) - new Date(from)) / 60000);
    if (minutes < 1) throw new Error("The window must close after it opens.");
    return minutes;
  }

  function recurrenceRule() {
    if (!repeat.value) return null;
    const rule = { freq: repeat.value, interval: requiredInt(interval, "Repeat interval", { min: 1 }) };
    const start = startMoment();
    if (repeat.value === "weekly") {
      const chosen = weekdayBoxes.map((entry, day) => (entry.box.checked ? day : null)).filter((day) => day !== null);
      if (!chosen.length) throw new Error("Choose at least one weekday.");
      rule.byWeekday = localWeekdaysToUtc(start, chosen);
    }
    if (repeat.value === "monthly") rule.monthly = monthly.value;
    if (endType.value === "never") rule.end = { type: "never" };
    else if (endType.value === "until") {
      const stop = localDateToUtc(until.value, { endOfDay: true });
      if (!stop) throw new Error("Choose the date the repeats end.");
      rule.end = { type: "until", until: stop };
    } else rule.end = { type: "count", count: requiredInt(count, "Number of times", { min: 1 }) };
    return rule;
  }

  function refreshVisibility() {
    const pbp = kind.value === "pbp";
    setElementVisible(liveRow, !pbp, "flex");
    setElementVisible(pbpRow, pbp, "flex");
    const mode = repeat.value;
    setElementVisible(repeatDetails, Boolean(mode), "flex");
    setElementVisible(weekdayField, mode === "weekly", "flex");
    setElementVisible(monthlyField, mode === "monthly", "flex");
    setElementVisible(untilField, Boolean(mode) && endType.value === "until", "flex");
    setElementVisible(countField, Boolean(mode) && endType.value === "count", "flex");
    reminderLabel.textContent = pbp ? "Reminder (hours before the window closes)" : "Reminder (hours before it starts)";
  }

  let previewTimer = 0;
  function schedulePreview() {
    window.clearTimeout(previewTimer);
    previewTimer = window.setTimeout(() => onChange?.(readPreviewSettings()), PREVIEW_DELAY_MS);
  }

  function readPreviewSettings() {
    try {
      const start = startMoment();
      if (!start) return null;
      return { start_at: start, duration_minutes: durationMinutes(), recurrence: recurrenceRule(), count: PREVIEW_COUNT, kind: kind.value };
    } catch (error) {
      return null;
    }
  }

  [kind, repeat, endType].forEach((node) => node.addEventListener("change", () => {
    refreshVisibility();
    schedulePreview();
  }));
  [liveStart, duration, pbpStart, pbpEnd, interval, monthly, until, count].forEach((node) => node.addEventListener("input", schedulePreview));
  weekdayBoxes.forEach((entry) => entry.box.addEventListener("change", schedulePreview));
  // A weekly series defaults to the weekday of its first date.
  const preselectWeekday = () => {
    if (repeat.value !== "weekly" || weekdayBoxes.some((entry) => entry.box.checked)) return;
    const stamp = kind.value === "pbp" ? pbpStart.value : liveStart.value.slice(0, 10);
    if (stamp) weekdayBoxes[new Date(`${stamp}T12:00`).getDay()].box.checked = true;
  };
  [liveStart, pbpStart].forEach((node) => node.addEventListener("input", preselectWeekday));
  repeat.addEventListener("change", preselectWeekday);

  const zoneNote = el("div", "small text-body-secondary", `Times are in your time zone (${localZoneName() || "local"}).`);
  const lockedThreads = el("div", "d-flex flex-column gap-1");
  threadBoxes.forEach((entry) => lockedThreads.appendChild(entry.wrap));
  if (!threadBoxes.length) lockedThreads.appendChild(el("span", "small text-body-secondary", "No threads yet."));

  root.append(
    heading("Identity"),
    field("Title", title),
    field("Description", description),
    heading("Type"),
    field("Kind", kind),
    heading("Schedule"),
    zoneNote,
    liveRow,
    pbpRow,
    ...(showRepeat ? [field("Repeats", repeat), repeatDetails, preview] : []),
    heading("Location"),
    field("Where", locationText),
    field("Link (optional)", locationUrl),
    heading("Players"),
    (() => {
      const row = el("div", "row g-2");
      [field("Minimum", minPlayers), field("Maximum", maxPlayers)].forEach((node) => {
        const col = el("div", "col-6");
        col.appendChild(node);
        row.appendChild(col);
      });
      return row;
    })(),
    heading("RSVP"),
    field("Cutoff (hours before it starts; empty for none)", cutoff),
    late.wrap,
    heading("Announcements"),
    field("Announce this many days ahead", lead),
    (() => {
      const wrap = el("div", "d-flex flex-column gap-1");
      wrap.append(reminderLabel, reminder);
      return wrap;
    })(),
    heading("Linked threads"),
    lockedThreads,
    heading("Behavior"),
    lock.wrap
  );
  refreshVisibility();
  schedulePreview();

  return {
    element: root,
    previewNode: preview,
    read() {
      const name = title.value.trim();
      if (!name) throw new Error("Give the session a title.");
      const start = startMoment();
      if (!start) throw new Error("Choose when it starts.");
      const minimum = intOrNull(minPlayers, "Minimum players");
      const maximum = intOrNull(maxPlayers, "Maximum players");
      if (minimum !== null && maximum !== null && maximum < minimum) throw new Error("The maximum can't be below the minimum.");
      return {
        title: name,
        description: description.value.trim(),
        kind: kind.value,
        start_at: start,
        duration_minutes: durationMinutes(),
        recurrence: recurrenceRule(),
        location_text: locationText.value.trim(),
        location_url: locationUrl.value.trim(),
        min_players: minimum,
        max_players: maximum,
        rsvp_cutoff_minutes: cutoff.value.trim() === "" ? null : Math.round(Number(cutoff.value) * 60),
        allow_late_rsvp: late.box.checked,
        lead_days: requiredInt(lead, "Announcement lead time"),
        reminder_minutes: reminder.value === "" ? null : Math.round(Number(reminder.value) * 60),
        lock_posting: lock.box.checked,
        thread_ids: threadBoxes.filter((entry) => entry.box.checked).map((entry) => entry.id),
      };
    },
  };
}

// --- the module ---------------------------------------------------------------------------------

export function initGroupSessions({ dataManager, getStatus, centerMount, inspectorMount }) {
  let group = null;
  let data = { series: [], occurrences: [] };
  let view = "upcoming";
  let selection = null;
  let threads = [];
  let journalPages = [];
  let calendar = null;
  let loadToken = 0;

  const status = () => getStatus?.();
  const say = (message, type = "success") => status()?.show(message, { type, timeout: type === "danger" ? 4000 : 1600 });

  // --- center: the list ---
  const listHost = el("div", "d-flex flex-column gap-2");
  const toggleHost = el("div");
  // Bordered like the Characters and Properties blocks beside it.
  const content = el("div", "d-flex flex-column gap-2 border rounded-3 p-2");
  content.append(toggleHost, listHost);
  const sectionParts = createCollapsibleSection({
    label: "Sessions",
    collapsed: false,
    helpTopic: "loom.groupSessions",
    actions: [{ icon: "tabler:plus", label: "Add session", onClick: () => select_({ kind: "new" }) }],
    content,
    className: "d-flex flex-column gap-2",
    panelClassName: "d-flex flex-column gap-2",
  });
  centerMount.appendChild(sectionParts.section);

  // --- right pane: the inspector ---
  const inspectorBody = el("div", "d-flex flex-column gap-3");
  const inspectorParts = createCollapsibleSection({
    label: "Session Inspector",
    collapsed: false,
    content: inspectorBody,
    className: "d-flex flex-column gap-3",
    panelClassName: "d-flex flex-column gap-3",
  });
  inspectorMount.appendChild(inspectorParts.section);
  setElementVisible(inspectorParts.section, false, "flex");

  function renderToggle() {
    createModeToggleGroup({
      container: toggleHost,
      ariaLabel: "Sessions view",
      value: view,
      options: [
        { value: "upcoming", label: "Upcoming", icon: "tabler:calendar-event" },
        { value: "history", label: "History", icon: "tabler:history" },
      ],
      onChange: (next) => {
        view = next;
        renderToggle();
        renderList();
      },
    });
  }

  function seriesOf(id) {
    return data.series.find((entry) => entry.id === id) || null;
  }

  function occurrenceRow(occurrence) {
    const series = seriesOf(occurrence.sessionId);
    const counts = occurrence.counts;
    const limits = [occurrence.minPlayers, occurrence.maxPlayers].map((n) => (n === null ? "–" : n)).join("–");
    const row = createListRow({
      title: formatSessionRange(occurrence.startAt, occurrence.endAt, { kind: occurrence.kind }),
      description: `${occurrence.title} · ${counts.accept} accepted${counts.waitlist ? `, ${counts.waitlist} waitlisted` : ""}${counts.tentative ? `, ${counts.tentative} maybe` : ""} · players ${limits}`,
      onSelect: () => select_({ kind: "occurrence", id: occurrence.id }),
    });
    const badges = el("div", "d-flex flex-wrap gap-1 mt-1");
    if (occurrence.status === "cancelled") badges.appendChild(badge("Cancelled", "danger"));
    if (series?.recurrence) badges.appendChild(badge("Recurring", "info"));
    if (occurrence.detached && occurrence.status !== "cancelled") badges.appendChild(badge("Edited", "warning"));
    if (occurrence.maxPlayers !== null && counts.accept >= occurrence.maxPlayers) badges.appendChild(badge("Full", "secondary"));
    if (occurrence.minPlayers !== null && counts.accept < occurrence.minPlayers && occurrence.status === "scheduled") {
      badges.appendChild(badge("Needs players", "warning"));
    }
    if (!occurrence.notified && occurrence.status === "scheduled") badges.appendChild(badge("Not announced yet", "secondary"));
    row.classList.add("loom-session-row");
    if (selection?.kind === "occurrence" && selection.id === occurrence.id) row.classList.add("border-primary");
    row.querySelector(".flex-grow-1").appendChild(badges);
    return row;
  }

  function pendingRow(series) {
    const row = createListRow({
      title: formatSessionRange(series.nextSlot, new Date(parseTimestamp(series.nextSlot) + series.durationMinutes * 60000).toISOString(), { kind: series.kind }),
      description: `${series.title} · announced ${series.leadDays} day${series.leadDays === 1 ? "" : "s"} ahead`,
      onSelect: () => select_({ kind: "slot", id: series.id, slotKey: series.nextSlot }),
    });
    row.classList.add("loom-session-row");
    const badges = el("div", "d-flex flex-wrap gap-1 mt-1");
    badges.appendChild(badge("Scheduled", "secondary"));
    if (series.recurrence) badges.appendChild(badge("Recurring", "info"));
    row.querySelector(".flex-grow-1").appendChild(badges);
    return row;
  }

  function renderList() {
    disposeTooltips(listHost);
    listHost.textContent = "";
    const now = Date.now();
    const ended = (occurrence) => parseTimestamp(occurrence.endAt) <= now;
    if (view === "history") {
      const past = data.occurrences.filter(ended).sort((a, b) => (a.startAt < b.startAt ? 1 : -1));
      if (!past.length) listHost.appendChild(el("p", "text-body-secondary small mb-0", "No past sessions yet."));
      past.forEach((occurrence) => {
        const row = occurrenceRow(occurrence);
        const extra = el("div", "d-flex flex-wrap gap-1 mt-1");
        if (occurrence.recapThreadId) extra.appendChild(badge("Thread linked", "success"));
        if (occurrence.recapPageId) extra.appendChild(badge("Recap page", "success"));
        if (occurrence.inworldFromDay !== null) extra.appendChild(badge("In-world dates noted", "success"));
        row.querySelector(".flex-grow-1").appendChild(extra);
        listHost.appendChild(row);
      });
    } else {
      const upcoming = data.occurrences.filter((occurrence) => !ended(occurrence)).sort((a, b) => (a.startAt > b.startAt ? 1 : -1));
      const createdSlots = new Set(data.occurrences.map((occurrence) => `${occurrence.sessionId}|${occurrence.slotKey}`));
      const pending = data.series.filter((series) => !series.endedAt && series.nextSlot && !createdSlots.has(`${series.id}|${series.nextSlot}`));
      if (!upcoming.length && !pending.length) {
        listHost.appendChild(el("p", "text-body-secondary small mb-0", "No upcoming sessions. Use + to add one."));
      }
      upcoming.forEach((occurrence) => listHost.appendChild(occurrenceRow(occurrence)));
      pending.forEach((series) => listHost.appendChild(pendingRow(series)));
    }
    refreshTooltips(listHost);
  }

  // --- data ---
  async function reload() {
    if (!group) return;
    const token = ++loadToken;
    try {
      const next = await dataManager.getGroupSessions(group.id);
      if (token !== loadToken) return;
      data = next;
    } catch (error) {
      say(error.message || "Unable to load sessions.", "danger");
      return;
    }
    renderList();
    renderInspector();
  }

  async function loadThreads() {
    try {
      const overview = await dataManager.getChatOverview({ groupId: group.id });
      threads = overview.channels.flatMap((channel) =>
        channel.threads.map((thread) => ({
          id: thread.id,
          label: `${channel.name} › ${thread.title}`,
          archived: Boolean(thread.archivedAt),
        }))
      );
    } catch (error) {
      threads = [];
    }
  }

  async function loadReferenceData() {
    const [pages, setting] = await Promise.all([
      fetchKindEntrySummaries(dataManager, "journal").catch(() => []),
      group.setting_id ? dataManager.get("setting", group.setting_id).catch(() => null) : Promise.resolve(null),
    ]);
    journalPages = pages;
    calendar = setting?.payload?.calendar || null;
  }

  function select_(next) {
    selection = next;
    renderList();
    renderInspector();
  }

  // --- inspector ---
  function inspectorHeader(text, ...badges) {
    const wrap = el("div", "d-flex flex-wrap align-items-center gap-2");
    wrap.append(el("h3", "h6 mb-0", text), ...badges);
    return wrap;
  }

  function actionRow(...buttons) {
    const row = el("div", "d-flex flex-wrap gap-2");
    row.append(...buttons);
    return row;
  }

  // Save / cancel / end live in the toolbar at the top of the inspector, as in
  // the other tools, not under the form. renderInspector builds the (empty)
  // toolbar first; each view fills it with the actions that apply.
  let toolbarGroup = null;
  function toolbarButton({ icon, label, variant = "outline-secondary", onClick }) {
    return createIconButton({ icon, label, variant, kind: "toolbar", tooltipPlacement: "top", onClick });
  }
  function setToolbar(buttons) {
    if (!toolbarGroup) return;
    disposeTooltips(toolbarGroup);
    toolbarGroup.textContent = "";
    toolbarGroup.append(...buttons);
    refreshTooltips(toolbarGroup);
  }

  function button(label, variant, onClick) {
    const node = el("button", `btn btn-${variant} btn-sm`, label);
    node.type = "button";
    node.addEventListener("click", onClick);
    return node;
  }

  function seriesFormWithPreview(initial, { showRepeat = true } = {}) {
    const form = buildSeriesForm({
      initial,
      showRepeat,
      threads: threads.filter((thread) => !thread.archived),
      onChange: async (settings) => {
        if (!settings) {
          form.previewNode.textContent = "";
          return;
        }
        try {
          const { slots } = await dataManager.previewSessionSlots(group.id, settings);
          form.previewNode.textContent = slots.length
            ? `Next dates: ${slots.map((slot) => formatSessionRange(slot.startAt, slot.endAt, { kind: settings.kind })).join("; ")}`
            : "";
        } catch (error) {
          form.previewNode.textContent = "";
        }
      },
    });
    return form;
  }

  function showNewSession() {
    const form = seriesFormWithPreview(null);
    setToolbar([
      toolbarButton({
        icon: "tabler:device-floppy",
        label: "Create session",
        variant: "primary",
        onClick: async () => {
          try {
            await dataManager.createGroupSession(group.id, form.read());
            say("Session created.");
            selection = null;
            await reload();
          } catch (error) {
            say(error.message || "Unable to create the session.", "danger");
          }
        },
      }),
      toolbarButton({ icon: "tabler:x", label: "Cancel", onClick: () => select_(null) }),
    ]);
    inspectorBody.append(inspectorHeader("New session"), form.element);
  }

  function seriesSection(series, { heading: text }) {
    const form = seriesFormWithPreview(series);
    const save = toolbarButton({
      icon: "tabler:device-floppy",
      label: "Save series",
      variant: "primary",
      onClick: async () => {
        try {
          await dataManager.updateGroupSession(group.id, series.id, form.read());
          say("Series updated.");
          await reload();
        } catch (error) {
          say(error.message || "Unable to save the series.", "danger");
        }
      },
    });
    const end = toolbarButton({
      icon: "tabler:calendar-off",
      label: "End series",
      variant: "outline-danger",
      onClick: async () => {
        const confirmed = await showConfirmModal({
          title: "End this series?",
          bodyHtml: '<p class="mb-0">No more dates are created, and its upcoming dates are cancelled.</p>',
          confirmLabel: "End series",
          confirmVariant: "danger",
        });
        if (!confirmed) return;
        try {
          await dataManager.endGroupSession(group.id, series.id);
          say("Series ended.");
          selection = null;
          await reload();
        } catch (error) {
          say(error.message || "Unable to end the series.", "danger");
        }
      },
    });
    const remove = toolbarButton({
      icon: "tabler:trash",
      label: "Delete session",
      variant: "outline-danger",
      onClick: async () => {
        const confirmed = await showConfirmModal({
          title: "Delete this session?",
          bodyHtml:
            '<p class="mb-0">The session, all of its dates (past ones too), their RSVPs and the notices about them are removed for good. To keep the history, end the series instead.</p>',
          confirmLabel: "Delete session",
          confirmVariant: "danger",
        });
        if (!confirmed) return;
        try {
          await dataManager.deleteGroupSession(group.id, series.id);
          say("Session deleted.");
          selection = null;
          await reload();
        } catch (error) {
          say(error.message || "Unable to delete the session.", "danger");
        }
      },
    });
    setToolbar([save, end, remove]);
    const wrap = el("div", "d-flex flex-column gap-3");
    wrap.append(
      el("p", "small text-body-secondary mb-0", `${describeRecurrence(series.recurrence, series.recurrence?.byWeekday ? utcWeekdaysToLocal(`${series.startAt}Z`, series.recurrence.byWeekday) : [])} · ${describeDuration(series.durationMinutes)}`),
      form.element
    );
    if (text) wrap.prepend(inspectorHeader(text));
    return wrap;
  }

  function showSlot(selected) {
    const series = seriesOf(selected.id);
    if (!series) return select_(null);
    const only = button("Edit or cancel just this date", "outline-primary", async () => {
      try {
        const occurrence = await dataManager.ensureSessionOccurrence(group.id, series.id, selected.slotKey);
        await reload();
        select_({ kind: "occurrence", id: occurrence.id });
      } catch (error) {
        say(error.message || "Unable to open that date.", "danger");
      }
    });
    inspectorBody.append(
      inspectorHeader(series.title, badge("Not announced yet", "secondary")),
      el("p", "small text-body-secondary mb-0", formatSessionRange(selected.slotKey, new Date(parseTimestamp(selected.slotKey) + series.durationMinutes * 60000).toISOString(), { kind: series.kind })),
      only,
      seriesSection(series, { heading: "Series" })
    );
  }

  function showOccurrence(selected) {
    const summary = data.occurrences.find((entry) => entry.id === selected.id);
    const series = summary ? seriesOf(summary.sessionId) : null;
    if (!summary || !series) return select_(null);
    const statusBadge = summary.status === "cancelled" ? badge("Cancelled", "danger") : badge(summary.detached ? "Edited" : "Scheduled", summary.detached ? "warning" : "secondary");
    inspectorBody.appendChild(inspectorHeader(formatSessionRange(summary.startAt, summary.endAt, { kind: summary.kind }), statusBadge));
    const scopeHost = el("div");
    const panel = el("div", "d-flex flex-column gap-3");
    inspectorBody.append(scopeHost, panel);
    let scope = "date";
    const renderScope = () => {
      createModeToggleGroup({
        container: scopeHost,
        ariaLabel: "What to edit",
        value: scope,
        options: [
          { value: "date", label: "This date only", icon: "tabler:calendar" },
          { value: "series", label: "Whole series", icon: "tabler:repeat" },
        ],
        onChange: (next) => {
          scope = next;
          renderScope();
          fill();
        },
      });
    };
    const fill = () => {
      panel.textContent = "";
      if (scope === "series") panel.appendChild(seriesSection(series, {}));
      else panel.appendChild(occurrenceEditor(summary, series));
      void initHelpSystem({ root: panel });
    };
    renderScope();
    fill();
    inspectorBody.appendChild(attendeesPanel(summary));
    inspectorBody.appendChild(afterPanel(summary));
  }

  function occurrenceEditor(summary, series) {
    if (summary.status === "cancelled") {
      setToolbar([]);
      return el("p", "small text-body-secondary mb-0", "This date was cancelled.");
    }
    // A single date edits through the same form as a series, prefilled with this date's own values.
    const seeded = {
      ...series,
      title: summary.title,
      description: summary.description,
      startAt: summary.startAt,
      durationMinutes: summary.durationMinutes,
      recurrence: null,
      locationText: summary.locationText,
      locationUrl: summary.locationUrl,
      minPlayers: summary.minPlayers,
      maxPlayers: summary.maxPlayers,
      rsvpCutoffMinutes: summary.rsvpCutoffMinutes,
      allowLateRsvp: summary.allowLateRsvp,
      threadIds: summary.threadIds,
    };
    const form = seriesFormWithPreview(seeded, { showRepeat: false });
    const save = toolbarButton({
      icon: "tabler:device-floppy",
      label: "Save this date",
      variant: "primary",
      onClick: async () => {
        try {
          const next = form.read();
          const patch = {};
          if (next.start_at !== new Date(`${summary.startAt}Z`).toISOString()) patch.start_at = next.start_at;
          const compare = {
            title: summary.title,
            description: summary.description,
            duration_minutes: summary.durationMinutes,
            location_text: summary.locationText,
            location_url: summary.locationUrl,
            min_players: summary.minPlayers,
            max_players: summary.maxPlayers,
            rsvp_cutoff_minutes: summary.rsvpCutoffMinutes,
            allow_late_rsvp: summary.allowLateRsvp,
          };
          Object.entries(compare).forEach(([key, value]) => {
            if (next[key] !== value) patch[key] = next[key];
          });
          if (JSON.stringify([...next.thread_ids].sort()) !== JSON.stringify([...summary.threadIds].sort())) patch.thread_ids = next.thread_ids;
          if (!Object.keys(patch).length) {
            say("Nothing changed.", "info");
            return;
          }
          if (patch.start_at) {
            const confirmed = await showConfirmModal({
              title: "Change the date or time?",
              bodyHtml: '<p class="mb-0">Everyone\'s RSVP for this date is cleared and they get a fresh notice.</p>',
              confirmLabel: "Change it",
            });
            if (!confirmed) return;
          }
          await dataManager.updateSessionOccurrence(group.id, summary.id, patch);
          say("Date updated.");
          await reload();
        } catch (error) {
          say(error.message || "Unable to save this date.", "danger");
        }
      },
    });
    const cancel = toolbarButton({
      icon: "tabler:calendar-off",
      label: "Cancel this date",
      variant: "outline-danger",
      onClick: async () => {
        const confirmed = await showConfirmModal({
          title: "Cancel this date?",
          bodyHtml: '<p class="mb-0">The rest of the series is unaffected. Players are notified.</p>',
          confirmLabel: "Cancel date",
          confirmVariant: "danger",
        });
        if (!confirmed) return;
        try {
          await dataManager.cancelSessionOccurrence(group.id, summary.id);
          say("Date cancelled.");
          await reload();
        } catch (error) {
          say(error.message || "Unable to cancel.", "danger");
        }
      },
    });
    setToolbar([save, cancel]);
    const wrap = el("div", "d-flex flex-column gap-3");
    wrap.append(form.element);
    return wrap;
  }

  // Who has answered, with a GM override per player.
  function attendeesPanel(summary) {
    const parts = createCollapsibleSection({
      label: "Attendees",
      collapsed: false,
      className: "d-flex flex-column gap-2",
      panelClassName: "d-flex flex-column gap-2",
      content: (panel) => {
        panel.appendChild(el("p", "small text-body-secondary mb-0", "Loading…"));
        void dataManager
          .getSessionOccurrence(summary.id)
          .then((detail) => {
            panel.textContent = "";
            if (!detail.attendees.length) {
              panel.appendChild(el("p", "small text-body-secondary mb-0", "No players have an active character in this group."));
              return;
            }
            detail.attendees.forEach((person) => {
              const row = el("div", "d-flex align-items-center justify-content-between gap-2");
              const name = el("div", "small");
              name.append(el("span", "fw-semibold", person.username), document.createTextNode(person.characterName ? ` (${person.characterName})` : ""));
              const answer = select(
                [["", "No response"], ["accept", "Accepted"], ["waitlist", "Waitlisted"], ["tentative", "Tentative"], ["decline", "Declined"]],
                person.response || ""
              );
              answer.classList.add("w-auto");
              answer.addEventListener("change", async () => {
                try {
                  await dataManager.rsvpSessionOccurrenceFor(summary.id, person.userId, answer.value || null);
                  await reload();
                } catch (error) {
                  say(error.message || "Unable to respond for that player.", "danger");
                  answer.value = person.response || "";
                }
              });
              row.append(name, answer);
              panel.appendChild(row);
            });
          })
          .catch((error) => {
            panel.textContent = "";
            panel.appendChild(el("p", "small text-danger mb-0", error.message || "Unable to load attendees."));
          });
      },
    });
    return parts.section;
  }

  // The record kept after a session: which in-world days it covered and where it was written up.
  function afterPanel(summary) {
    const parts = createCollapsibleSection({
      label: "After the session",
      collapsed: !(parseTimestamp(summary.endAt) <= Date.now()),
      className: "d-flex flex-column gap-2",
      panelClassName: "d-flex flex-column gap-2",
      content: (panel) => {
        const from = control("input", { type: "number", step: 1, value: summary.inworldFromDay ?? "" });
        const to = control("input", { type: "number", step: 1, value: summary.inworldToDay ?? "" });
        const note = el("div", "small text-body-secondary");
        const describeDays = () => {
          const parts2 = [from, to].map((input) => (input.value === "" ? "" : calendar ? formatCalendarDate(calendar, Number(input.value)) : `Day ${input.value}`));
          note.textContent = parts2[0] || parts2[1] ? `${parts2[0] || "?"} → ${parts2[1] || "?"}` : "";
        };
        [from, to].forEach((input) => input.addEventListener("input", describeDays));
        describeDays();
        const recapThread = select([["", "None"], ...threads.map((thread) => [thread.id, `${thread.label}${thread.archived ? " (archived)" : ""}`])], summary.recapThreadId || "");
        const recapPage = select([["", "None"], ...journalPages.map((page) => [page.id, page.name])], summary.recapPageId || "");
        const row = el("div", "row g-2");
        [field("In-world from (day)", from), field("In-world to (day)", to)].forEach((node) => {
          const col = el("div", "col-6");
          col.appendChild(node);
          row.appendChild(col);
        });
        const save = button("Save", "primary", async () => {
          try {
            await dataManager.setSessionOccurrenceHistory(group.id, summary.id, {
              inworldFromDay: intOrNull(from, "In-world start", { min: Number.MIN_SAFE_INTEGER }),
              inworldToDay: intOrNull(to, "In-world end", { min: Number.MIN_SAFE_INTEGER }),
              recapThreadId: recapThread.value || null,
              recapPageId: recapPage.value || null,
            });
            say("Saved.");
            await reload();
          } catch (error) {
            say(error.message || "Unable to save.", "danger");
          }
        });
        panel.append(row, note, field("Thread it covered", recapThread), field("Recap page", recapPage), actionRow(save));
      },
    });
    return parts.section;
  }

  function renderInspector() {
    disposeTooltips(inspectorBody);
    inspectorBody.textContent = "";
    const toolbar = el("div", "btn-toolbar justify-content-center overflow-x-auto");
    toolbar.setAttribute("role", "toolbar");
    toolbar.setAttribute("aria-label", "Session actions");
    toolbarGroup = el("div", "btn-group");
    toolbar.appendChild(toolbarGroup);
    inspectorBody.appendChild(toolbar);
    if (!selection || !group) {
      setElementVisible(inspectorParts.section, false, "flex");
      return;
    }
    setElementVisible(inspectorParts.section, true, "flex");
    if (selection.kind === "new") showNewSession();
    else if (selection.kind === "slot") showSlot(selection);
    else showOccurrence(selection);
    void initHelpSystem({ root: inspectorBody });
    refreshTooltips(inspectorBody);
  }

  renderToggle();

  return {
    async showGroup(nextGroup) {
      const changed = !group || group.id !== nextGroup.id;
      group = nextGroup;
      if (changed) {
        selection = null;
        data = { series: [], occurrences: [] };
        renderList();
        renderInspector();
      }
      await Promise.all([loadThreads(), loadReferenceData()]);
      await reload();
    },
    // The right-pane toolbar's Add Session button.
    addSession() {
      if (group) select_({ kind: "new" });
    },
    clear() {
      group = null;
      selection = null;
      data = { series: [], occurrences: [] };
      listHost.textContent = "";
      renderInspector();
    },
  };
}
