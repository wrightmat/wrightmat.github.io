// Showing a session's UTC moments in the viewer's own time zone.
import { normalizeTimestamp } from "../chat/format.js";

const WEEKDAY_NAMES = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];

function toDate(value) {
  const date = new Date(normalizeTimestamp(value));
  return Number.isNaN(date.getTime()) ? null : date;
}

// "Thu, Nov 6 · 7:00 – 10:00 PM CST"; spans days as "Nov 6 – Nov 9" for a play-by-post window.
export function formatSessionRange(startIso, endIso, { kind = "live" } = {}) {
  const start = toDate(startIso);
  const end = toDate(endIso);
  if (!start) return "";
  if (kind === "pbp" && end) {
    const day = { weekday: "short", month: "short", day: "numeric" };
    return `${start.toLocaleDateString([], day)} – ${end.toLocaleDateString([], day)}`;
  }
  const dayText = start.toLocaleDateString([], { weekday: "short", month: "short", day: "numeric" });
  const startTime = start.toLocaleTimeString([], { hour: "numeric", minute: "2-digit" });
  if (!end) return `${dayText} · ${startTime}`;
  const endTime = end.toLocaleTimeString([], { hour: "numeric", minute: "2-digit", timeZoneName: "short" });
  const sameDay = start.toDateString() === end.toDateString();
  return sameDay ? `${dayText} · ${startTime} – ${endTime}` : `${dayText} ${startTime} – ${end.toLocaleDateString([], { month: "short", day: "numeric" })} ${endTime}`;
}

export function formatSessionDate(iso) {
  const date = toDate(iso);
  return date ? date.toLocaleDateString([], { weekday: "short", month: "short", day: "numeric", year: "numeric" }) : "";
}

export function describeDuration(minutes) {
  if (minutes % (60 * 24) === 0) return `${minutes / (60 * 24)} day${minutes === 60 * 24 ? "" : "s"}`;
  const hours = Math.floor(minutes / 60);
  const rest = minutes % 60;
  if (!hours) return `${rest} min`;
  return rest ? `${hours} h ${rest} min` : `${hours} h`;
}

// A recurrence rule in words, in the viewer's own weekdays.
export function describeRecurrence(rule, localWeekdays = []) {
  if (!rule) return "Does not repeat";
  const every = (unit) => (rule.interval === 1 ? `Every ${unit}` : `Every ${rule.interval} ${unit}s`);
  let text;
  if (rule.freq === "daily") text = every("day");
  else if (rule.freq === "weekly") {
    const days = localWeekdays.map((day) => WEEKDAY_NAMES[day]).join(", ");
    text = `${every("week")}${days ? ` on ${days}` : ""}`;
  } else text = `${every("month")}, ${rule.monthly === "nthWeekday" ? "same weekday" : "same date"}`;
  if (rule.end?.type === "count") text += `, ${rule.end.count} times`;
  if (rule.end?.type === "until") text += `, until ${formatSessionDate(rule.end.until)}`;
  return text;
}

export const RESPONSE_LABELS = { accept: "Accepted", waitlist: "Waitlisted", tentative: "Tentative", decline: "Declined" };
