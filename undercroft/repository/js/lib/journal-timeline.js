// Repository's "Timeline" view — a computed, day-sorted list of every
// `date:` reference (journal-date.js) across the whole workspace, built the
// same "computed on demand, not a new authored entity" way Relationships
// already is (relationships-graph.js) — no state, no calendar concept; just
// extracts and flattens.
import { fetchKindEntriesWithIds } from "../../../common/js/lib/content-fetch.js";
import { extractDateReferences } from "./journal-date.js";

// Every `date:` reference across every journal page, attributed to its own
// page — `{dayIndex, isCurrent, label, pageId, pageTitle}[]`, UNSORTED.
// `date:current`/`date:today` entries keep `dayIndex: null` — resolving
// against the live ambient day (and sorting) is the caller's job, same
// split journal-date.js's applyDateReferences uses.
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

// Resolves every `isCurrent` entry's null dayIndex against the live ambient
// day, then groups by resolved day and sorts ascending — the shape
// repository/js/app.js's renderTimeline draws directly. `currentDayIndex`
// absent/non-finite (no active campaign date yet) drops `isCurrent` entries
// from the result rather than guessing a day for them.
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
