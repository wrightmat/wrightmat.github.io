// Repository's "Timeline" view — a computed, day-sorted list of every
// `date:` reference (journal-date.js) across the whole workspace, built the
// same "computed on demand, not a new authored entity" way Relationships
// already is (relationships-graph.js) — this module has no state of its
// own and no calendar concept at all; it just extracts and flattens.
import { fetchKindEntriesWithIds } from "../../../common/js/lib/content-fetch.js";
import { extractDateReferences } from "./journal-date.js";

// Every `date:` reference across every journal page, attributed back to its
// own page — `{dayIndex, isCurrent, label, pageId, pageTitle}[]`,
// UNSORTED. `date:current`/`date:today` entries keep `dayIndex: null` —
// resolving that against the live ambient day (and sorting the final list)
// is the caller's own job, same split journal-date.js's own
// applyDateReferences already uses for activeCalendar/currentDayIndex; this
// module is deliberately calendar-agnostic.
export async function buildTimeline(dataManager) {
  const entries = await fetchKindEntriesWithIds(dataManager, "journal").catch(() => []);
  const items = [];
  entries.forEach((entry) => {
    const payload = entry.entity || {};
    extractDateReferences(payload.body || "").forEach((reference) => {
      items.push({ ...reference, pageId: entry.id, pageTitle: payload.title || entry.id });
    });
  });
  return items;
}

// Resolves every `isCurrent` entry's own null dayIndex against the live
// ambient day, then groups by resolved day and sorts ascending — the shape
// repository/js/app.js's own renderTimeline draws directly. `currentDayIndex`
// absent/non-finite (no active campaign date yet) drops `isCurrent` entries
// from the grouped result entirely rather than guessing a day for them;
// they're still real content, just not orderable yet.
export function groupTimelineByDay(items, currentDayIndex) {
  const hasCurrentDay = Number.isFinite(currentDayIndex);
  const byDay = new Map();
  items.forEach((item) => {
    const dayIndex = item.isCurrent ? (hasCurrentDay ? currentDayIndex : null) : item.dayIndex;
    if (dayIndex === null || !Number.isFinite(dayIndex)) return;
    if (!byDay.has(dayIndex)) byDay.set(dayIndex, []);
    byDay.get(dayIndex).push(item);
  });
  return Array.from(byDay.entries())
    .sort(([a], [b]) => a - b)
    .map(([dayIndex, dayItems]) => ({ dayIndex, items: dayItems }));
}
