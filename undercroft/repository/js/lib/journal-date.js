// A `` `date:<dayIndex>` `` inline code span — a deadline, discovered-on
// date, etc. Same "post-render <code> swap" shape as journal-dice.js/
// journal-encounter.js/journal-macro.js, but not a kind reference: there's
// no "date" Library entity, just formatting against the active Setting's
// calendar via calendar.js's own describeDate. Purely informational, unlike
// dice/encounter/macro — no click action. extractDateReferences below feeds
// journal-timeline.js's chronological ordering.
import { el } from "../../../common/js/lib/dom.js";
import { describeDate } from "../../../common/js/lib/widgets/calendar.js";
import { setDisabledTooltip } from "../../../common/js/lib/tooltips.js";

// `123` or `123|Label` — dayIndex is a raw signed integer, the same day-
// count representation the Calendar widget uses (day 0 = campaign start).
// `current`/`today` (case-insensitive) means "whatever the campaign's
// ambient date is right now", resolved by the caller via `currentDayIndex`
// below rather than a literal number ever appearing in the source.
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

// `calendar` may be absent — describeDate falls back to a plain "Day <N>"
// reading itself. `isCurrent` swaps the icon/tooltip so a `date:current`
// chip still reads as distinct once formatted. Returns `{button, tooltipText}`
// rather than just `button` — a disabled control can't carry a working
// tooltip trigger (tooltips.js BUG CLASS 1), so the caller wires it via
// setDisabledTooltip after this chip has a real DOM parent.
function buildDateChip(dayIndex, label, calendar, { isCurrent = false } = {}) {
  const button = el("button", "repository-date-chip");
  button.type = "button";
  button.disabled = true; // genuinely inert — no action, not just unclickable styling
  styleAsChip(button);
  const icon = el("span", "iconify");
  icon.dataset.icon = isCurrent ? "tabler:calendar-star" : "tabler:calendar-event";
  icon.setAttribute("aria-hidden", "true");
  if (dayIndex === null) {
    button.append(icon, el("span", null, label ? `${label}: no campaign date set` : "No campaign date set"));
    return { button, tooltipText: "This campaign has no active date yet — set one from a Calendar widget." };
  }
  const formatted = describeDate(calendar || {}, dayIndex);
  button.append(icon, el("span", null, label ? `${label}: ${formatted}` : formatted));
  return { button, tooltipText: isCurrent ? `Today — Day ${dayIndex}` : `Day ${dayIndex}` };
}

// Same match/parse as applyDateReferences below, factored out so
// journal-timeline.js can extract references from a page's raw markdown
// body directly (no rendered DOM to scan, same split extractQuests/
// extractContentReferences use). A plain global scan over raw backtick
// text, rather than DATE_CODE_PATTERN's single already-extracted-span match.
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

// Every `` `date:...` `` reference in one page's raw body —
// `[{dayIndex, isCurrent, label}]`, day-unsorted (buildTimeline's own job
// across every page). `dayIndex` is null for an `isCurrent` entry, resolved
// against the live ambient day only by a caller that has it.
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
// applyEncounterBlocks/applyMacroBlocks. `activeCalendar` is pre-resolved by
// the caller so renderMarkdown stays fully synchronous, same convention
// validKindIds/kindLabels follow for kind-reference chips. `currentDayIndex`
// is only consulted for a `date:current`/`date:today` span; a fixed
// `date:123` never touches it.
export function applyDateReferences(container, { activeCalendar, currentDayIndex } = {}) {
  container.querySelectorAll("code").forEach((codeEl) => {
    const match = DATE_CODE_PATTERN.exec(codeEl.textContent.trim());
    if (!match) return;
    const parsed = parseDateMatch(match[1], match[2]);
    if (!parsed) return;
    if (parsed.isCurrent) {
      const dayIndex = Number.isFinite(currentDayIndex) ? currentDayIndex : null;
      const { button, tooltipText } = buildDateChip(dayIndex, parsed.label, activeCalendar, { isCurrent: true });
      codeEl.replaceWith(button);
      setDisabledTooltip(button, tooltipText);
      return;
    }
    const { button, tooltipText } = buildDateChip(parsed.dayIndex, parsed.label, activeCalendar);
    codeEl.replaceWith(button);
    setDisabledTooltip(button, tooltipText);
  });
}
