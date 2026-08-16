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
// Determining what's overdue, ordering events chronologically, or a
// timeline view are all real future uses of this data, deliberately not
// built here; this pass only establishes the reference type itself and
// renders it correctly formatted.
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
    const label = (match[2] || "").trim();
    const raw = match[1].toLowerCase();
    if (raw === "current" || raw === "today") {
      const dayIndex = Number.isFinite(currentDayIndex) ? currentDayIndex : null;
      codeEl.replaceWith(buildDateChip(dayIndex, label, activeCalendar, { isCurrent: true }));
      return;
    }
    const dayIndex = Number(raw);
    if (!Number.isFinite(dayIndex)) return;
    codeEl.replaceWith(buildDateChip(dayIndex, label, activeCalendar));
  });
}
