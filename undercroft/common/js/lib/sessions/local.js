// Session times are stored and compared as UTC; people think in local time.
// These translate between a browser's local date/time inputs and UTC, and map
// weekdays across the two (the server repeats on UTC weekdays).
import { normalizeTimestamp } from "../chat/format.js";

const pad = (value) => String(value).padStart(2, "0");

// "2026-03-05T19:00" (a datetime-local value, read as local) -> UTC ISO.
export function localInputToUtc(value) {
  if (!value) return "";
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? "" : date.toISOString();
}

// UTC ISO (with or without a zone suffix) -> a datetime-local value in local time.
export function utcToLocalInput(value) {
  if (!value) return "";
  const date = new Date(normalizeTimestamp(value));
  if (Number.isNaN(date.getTime())) return "";
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}T${pad(date.getHours())}:${pad(date.getMinutes())}`;
}

// "2026-03-05" (a date input, read as local) -> UTC ISO at local start of day,
// or at the end of that day for a window's closing edge.
export function localDateToUtc(value, { endOfDay = false } = {}) {
  if (!value) return "";
  const date = new Date(`${value}T${endOfDay ? "23:59:59" : "00:00:00"}`);
  return Number.isNaN(date.getTime()) ? "" : date.toISOString();
}

export function utcToLocalDate(value) {
  return utcToLocalInput(value).slice(0, 10);
}

// How many days the UTC calendar date of `startUtc` is ahead of its local one
// (-1, 0 or 1). Every slot of a series shares one time of day, so one shift
// applies to all its weekdays.
function weekdayShift(startUtc) {
  const date = new Date(normalizeTimestamp(startUtc));
  const utcDay = date.getUTCDay();
  const localDay = date.getDay();
  return ((utcDay - localDay + 10) % 7) - 3;
}

export function localWeekdaysToUtc(startUtc, localWeekdays) {
  const shift = weekdayShift(startUtc);
  return [...new Set(localWeekdays.map((day) => (day + shift + 7) % 7))].sort((a, b) => a - b);
}

export function utcWeekdaysToLocal(startUtc, utcWeekdays) {
  const shift = weekdayShift(startUtc);
  return [...new Set(utcWeekdays.map((day) => (day - shift + 7) % 7))].sort((a, b) => a - b);
}

// The user's own time zone, for labelling inputs ("Times are in America/Chicago").
export function localZoneName() {
  try {
    return Intl.DateTimeFormat().resolvedOptions().timeZone || "";
  } catch (error) {
    return "";
  }
}
