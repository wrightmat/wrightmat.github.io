// Obsidian "Tasks"-plugin-style interactive checkboxes. `- [ ] Todo` /
// `- [x] Done` GFM task-list syntax already renders as real (but `disabled`)
// checkboxes via marked's own default GFM support — nothing custom needed
// to parse the syntax itself. This module makes them clickable (always —
// that part isn't optional) and keeps the underlying markdown source in
// sync; whether checking one off *also* appends a "✅ YYYY-MM-DD" completion
// stamp (Obsidian's own Tasks plugin convention) is Repository's own
// settings toggle, plumbed through as toggleTaskLine's `appendStamp` option.
const TASK_LINE_PATTERN = /^(\s*[-*+]\s+\[)([ xX])(\]\s*)(.*)$/;
const COMPLETION_STAMP_PATTERN = /\s*✅\s*\d{4}-\d{2}-\d{2}\s*$/;

function todayStamp() {
  const now = new Date();
  const pad = (n) => String(n).padStart(2, "0");
  return `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}`;
}

// Every `- [ ]`/`- [x]` line, in document order — positionally paired with
// marked's own rendered checkboxes below (both are the same top-to-bottom
// scan of the same text), same convention journal-outline.js's heading
// pairing already uses for its own repo-heading-<index> ids.
export function extractTaskLines(body) {
  const lines = String(body || "").split("\n");
  const tasks = [];
  lines.forEach((line, index) => {
    if (TASK_LINE_PATTERN.test(line)) tasks.push({ line: index });
  });
  return tasks;
}

// The line's own text after "- [ ] "/"- [x] " — what a checkbox's <li>
// should actually display, without re-parsing markdown for it.
export function taskLineText(body, lineIndex) {
  const line = String(body || "").split("\n")[lineIndex] || "";
  const match = TASK_LINE_PATTERN.exec(line);
  return match ? match[4] : "";
}

// Pure — toggles one task line's checked state in the raw text and returns
// the updated full body string, no DOM involved, so app.js's recordHistory
// can wrap it exactly the same way every other body edit already is.
// Checking a box always flips [ ]→[x]; whether that *also* appends a
// "✅ YYYY-MM-DD" stamp is the one thing `appendStamp` controls (Repository's
// own settings toggle) — unchecking always strips any existing stamp
// regardless of that setting, since a stamp left behind on an unchecked task
// would just be stale/wrong, not a matter of preference.
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
// with fresh text — task-list line content is simple inline prose, not
// nested block markdown, so this doesn't need a full re-render of the
// preview (and the scroll position that would disturb) just to reflect one
// line's new completion stamp.
export function updateCheckboxLineText(checkbox, text) {
  const li = checkbox.closest("li");
  if (!li) return;
  Array.from(li.childNodes).forEach((node) => {
    if (node !== checkbox) li.removeChild(node);
  });
  li.appendChild(document.createTextNode(` ${text}`));
}

// Runs after marked+DOMPurify — enables whichever checkboxes marked already
// rendered and wires each one back to its own line number by position.
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
