// A `` `date:<dayIndex>` `` inline code span — a deadline, a discovered-on
// date, a due date — attached to a quest or an objective the same way any
// other inline reference is. Same "post-render <code> swap" shape as
// journal-dice.js/journal-encounter.js/journal-macro.js, but NOT a kind
// reference (journal-kind-reference.js) — there's no "date" Library entity
// to look up, this is pure formatting against whichever calendar the
// active Setting defines, reusing common/js/lib/widgets/calendar.js's own
// formatCalendarDate/describeDate rather than a second implementation.
//
// Purely informational, unlike dice/encounter/macro — no click action.
// Determining what's overdue is still out of scope, but ordering events
// chronologically is now built — see extractDateReferences below and
// journal-timeline.js, which consumes it.
import { el } from "../../../common/js/lib/dom.js";
import { describeDate } from "../../../common/js/lib/widgets/calendar.js";

// `123` or `123|Label` — dayIndex is a raw signed integer, the exact same
// day-count representation the Calendar widget and the ambient campaign
// date already use (day 0 = campaign start, negative days before it) — so
// a date written here means the same thing everywhere else in the suite
// that reads a dayIndex. `current`/`today` (case-insensitive) is the one
// other allowed value — not a fixed day, but "whatever the campaign's own
// ambient date is right now" (same value the Calendar widget itself reads/
// writes), resolved by the caller via `currentDayIndex` below rather than a
// literal number ever appearing in the source.
const DATE_CODE_PATTERN = /^date:\s*(-?\d+|current|today)\s*(?:\|\s*(.+))?$/i;

function styleAsChip(button) {
  button.style.display = "inline-flex";
  button.style.alignItems = "center";
  button.style.gap = "0.25rem";
  button.style.padding = "0.05rem 0.4rem";
  button.style.border = "1px solid var(--bs-border-color, #dee2e6)";
  button.style.borderRadius = "0.375rem";
  button.style.background = "var(--bs-tertiary-bg, #f8f9fa)";
  button.style.color = "inherit";
  button.style.font = "inherit";
  button.style.lineHeight = "1.4";
  button.style.cursor = "default";
}

// `calendar` is the active Setting's own `.calendar` field, or null/absent
// when there isn't one — describeDate already handles that case itself
// (falls back to a plain "Day <N>" reading), so this never needs its own
// separate "no calendar" branch. `isCurrent` swaps the icon (a small "now"
// indicator, tabler:calendar-star instead of tabler:calendar-event) and the
// tooltip wording so a `date:current` chip still visually reads as distinct
// from a fixed date, even once formatted the same way.
function buildDateChip(dayIndex, label, calendar, { isCurrent = false } = {}) {
  const button = el("button", "repository-date-chip");
  button.type = "button";
  // A real <button> (matching every other reference chip's own element
  // choice) but genuinely inert here — disabled, not just unclickable
  // styling, since there's no action for it to ever perform this pass.
  button.disabled = true;
  styleAsChip(button);
  const icon = el("span", "iconify");
  icon.dataset.icon = isCurrent ? "tabler:calendar-star" : "tabler:calendar-event";
  icon.setAttribute("aria-hidden", "true");
  if (dayIndex === null) {
    button.append(icon, el("span", null, label ? `${label}: no campaign date set` : "No campaign date set"));
    button.title = "This campaign has no active date yet — set one from a Calendar widget.";
    return button;
  }
  const formatted = describeDate(calendar || {}, dayIndex);
  button.append(icon, el("span", null, label ? `${label}: ${formatted}` : formatted));
  button.title = isCurrent ? `Today — Day ${dayIndex}` : `Day ${dayIndex}`;
  return button;
}

// Same match/parse as applyDateReferences below, factored out so
// journal-timeline.js can extract the reference list from a page's own RAW
// markdown body (buildTimeline has no rendered DOM to scan — it fetches
// every page's stored body directly, same as extractQuests/
// extractContentReferences already do for quests/kind-reference chips) —
// this is that same "parse independent of render" split, just for dates.
// Raw markdown text uses backticks directly (` ``date:30`` ` — not yet a
// `<code>` element the way applyDateReferences' own DOM pass sees it), so
// this is a plain global, un-anchored scan rather than DATE_CODE_PATTERN's
// own single already-extracted-span match.
const DATE_MARKDOWN_PATTERN = /`date:\s*(-?\d+|current|today)\s*(?:\|\s*([^`]+))?`/gi;

function parseDateMatch(rawValue, rawLabel) {
  const raw = rawValue.toLowerCase();
  const label = (rawLabel || "").trim();
  const isCurrent = raw === "current" || raw === "today";
  if (isCurrent) return { dayIndex: null, isCurrent: true, label };
  const dayIndex = Number(raw);
  if (!Number.isFinite(dayIndex)) return null;
  return { dayIndex, isCurrent: false, label };
}

// Every `` `date:...` `` reference in one page's own raw body —
// `[{dayIndex, isCurrent, label}]`, day-unsorted (buildTimeline's own job,
// across every page at once). `dayIndex` is null for an `isCurrent` entry
// — resolved against the live ambient day only by the caller that actually
// has it (same split applyDateReferences' own `currentDayIndex` param
// already establishes), never baked in here.
export function extractDateReferences(body) {
  const text = String(body || "");
  const results = [];
  let match;
  DATE_MARKDOWN_PATTERN.lastIndex = 0;
  while ((match = DATE_MARKDOWN_PATTERN.exec(text))) {
    const parsed = parseDateMatch(match[1], match[2]);
    if (parsed) results.push(parsed);
  }
  return results;
}

// Runs after marked+DOMPurify, same stage as applyDiceRollers/
// applyEncounterBlocks/applyMacroBlocks — CommonMark's own backtick syntax
// already turned `` `date:...` `` into a plain <code>...</code>; this finds
// those and swaps each one for a chip. `activeCalendar` is pre-resolved by
// the caller (renderMarkdown's own caller, from the active Setting) —
// renderMarkdown stays fully synchronous, same convention validKindIds/
// kindLabels already follow for kind-reference chips. `currentDayIndex` is
// the same ambient value the Calendar widget itself reads/writes (or
// null/undefined before it resolves, or if this campaign has never had one
// set) — only consulted for a `` `date:current` ``/`` `date:today` `` span;
// a fixed `` `date:123` `` never touches it.
export function applyDateReferences(container, { activeCalendar, currentDayIndex } = {}) {
  container.querySelectorAll("code").forEach((codeEl) => {
    const match = DATE_CODE_PATTERN.exec(codeEl.textContent.trim());
    if (!match) return;
    const parsed = parseDateMatch(match[1], match[2]);
    if (!parsed) return;
    if (parsed.isCurrent) {
      const dayIndex = Number.isFinite(currentDayIndex) ? currentDayIndex : null;
      codeEl.replaceWith(buildDateChip(dayIndex, parsed.label, activeCalendar, { isCurrent: true }));
      return;
    }
    codeEl.replaceWith(buildDateChip(parsed.dayIndex, parsed.label, activeCalendar));
  });
}
