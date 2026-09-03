// Obsidian "Tasks"-plugin-style interactive checkboxes. `- [ ] Todo` /
// `- [x] Done` GFM task-list syntax already renders as real (but `disabled`)
// checkboxes via marked's own default GFM support. This module makes them
// clickable and keeps the underlying markdown source in sync; whether
// checking one off also appends a "✅ YYYY-MM-DD" completion stamp
// (Obsidian's own Tasks-plugin convention) is Repository's own settings
// toggle, plumbed through as toggleTaskLine's `appendStamp` option.
// The optional `(?:>\s?)*` prefix tolerates one or more blockquote markers
// before the list marker — a `[!quest]` objective line in the PAGE's own raw
// body reads as `> - [ ] ...`, not `- [ ] ...` (the ">" is only stripped once
// parseCallout pulls a callout's bodyRaw out — see journal-quests.js's
// extractQuests). Without this, extractTaskLines run against a whole page
// found zero task lines inside any callout, leaving those checkboxes
// permanently disabled.
const TASK_LINE_PATTERN = /^((?:>\s?)*\s*[-*+]\s+\[)([ xX])(\]\s*)(.*)$/;
const COMPLETION_STAMP_PATTERN = /\s*✅\s*\d{4}-\d{2}-\d{2}\s*$/;

function todayStamp() {
  const now = new Date();
  const pad = (n) => String(n).padStart(2, "0");
  return `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}`;
}

// Every `- [ ]`/`- [x]` line, in document order — positionally paired with
// marked's own rendered checkboxes below (both are the same top-to-bottom
// scan of the same text). Surfaced here once so a quest callout's own
// objective list (journal-quests.js) doesn't need a second pass.
export function extractTaskLines(body) {
  const lines = String(body || "").split("\n");
  const tasks = [];
  lines.forEach((line, index) => {
    const match = TASK_LINE_PATTERN.exec(line);
    if (match) tasks.push({ line: index, checked: match[2].toLowerCase() === "x", text: match[4] });
  });
  return tasks;
}

// The line's own text after "- [ ] "/"- [x] " — what a checkbox's <li>
// should display, without re-parsing markdown for it.
export function taskLineText(body, lineIndex) {
  const line = String(body || "").split("\n")[lineIndex] || "";
  const match = TASK_LINE_PATTERN.exec(line);
  return match ? match[4] : "";
}

// Pure — toggles one task line's checked state in the raw text and returns
// the updated full body string, no DOM involved, so app.js's recordHistory
// can wrap it exactly like every other body edit. Checking a box always
// flips [ ]→[x]; `appendStamp` (Repository's settings toggle) is the one
// thing that controls whether a "✅ YYYY-MM-DD" stamp gets appended —
// unchecking always strips any existing stamp regardless of that setting,
// since a stamp left on an unchecked task would just be stale.
export function toggleTaskLine(body, lineIndex, { appendStamp = true } = {}) {
  const lines = String(body || "").split("\n");
  const line = lines[lineIndex];
  if (line === undefined) return body;
  const match = TASK_LINE_PATTERN.exec(line);
  if (!match) return body;
  const [, prefix, mark, closer, rest] = match;
  const isChecked = mark.toLowerCase() === "x";
  if (isChecked) {
    lines[lineIndex] = `${prefix} ${closer}${rest.replace(COMPLETION_STAMP_PATTERN, "")}`;
  } else {
    const cleanRest = rest.replace(COMPLETION_STAMP_PATTERN, "");
    lines[lineIndex] = `${prefix}x${closer}${cleanRest}${appendStamp ? ` ✅ ${todayStamp()}` : ""}`;
  }
  return lines.join("\n");
}

// Replaces everything inside a checkbox's <li> except the checkbox itself
// with fresh text — task-list content is simple inline prose, not nested
// block markdown, so this avoids a full re-render (and the scroll-position
// disturbance that would cause) just to reflect one line's new stamp.
export function updateCheckboxLineText(checkbox, text) {
  const li = checkbox.closest("li");
  if (!li) return;
  Array.from(li.childNodes).forEach((node) => {
    if (node !== checkbox) li.removeChild(node);
  });
  li.appendChild(document.createTextNode(` ${text}`));
}

// Runs after marked+DOMPurify — enables whichever checkboxes marked already
// rendered and wires each back to its own line number by position.
export function applyTaskCheckboxes(container, { body, onToggle } = {}) {
  const tasks = extractTaskLines(body);
  const checkboxes = container.querySelectorAll('input[type="checkbox"]');
  checkboxes.forEach((checkbox, index) => {
    const task = tasks[index];
    if (!task) return;
    checkbox.disabled = false;
    checkbox.style.cursor = "pointer";
    checkbox.addEventListener("change", () => onToggle?.(task.line, checkbox));
  });
}
