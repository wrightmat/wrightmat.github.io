// Obsidian-style inline macro triggers — `` `macro: Haunted Forest` `` is
// ordinary CommonMark inline code; this finds those after the fact and
// swaps each for a clickable chip. Resolution and execution both go through
// the same runMacro (macro-runner.js) the Dashboard's Macro board uses — a
// Journal note is just another trigger surface, not a second implementation.
// Unlike `` `encounter:...` ``, no page-specific context is needed to run a
// macro, so this stays self-contained instead of routing through a callback.
import { fetchKindEntriesWithIds } from "../../../common/js/lib/content-fetch.js";
import { runMacro } from "../../../common/js/lib/widgets/macro-runner.js";
import { fetchWledDevices } from "../../../common/js/lib/widgets/wled.js";
import { el } from "../../../common/js/lib/dom.js";

const MACRO_CODE_PATTERN = /^macro:\s*(.+)$/i;

// Case-insensitive match against id or display name — no fuzzy matching, an
// unmatched reference just fails clearly (see runMacroReference below).
// Exported for journal-kind-reference.js's Related-panel resolution too.
export async function findMacro(dataManager, ref) {
  const entries = await fetchKindEntriesWithIds(dataManager, "macro");
  const normalized = ref.trim().toLowerCase();
  const match = entries.find(({ id, entity }) => {
    if (String(id).toLowerCase() === normalized) return true;
    const name = String(entity?.name || "").trim().toLowerCase();
    return name === normalized;
  });
  return match ? { id: match.id, ...(match.entity && typeof match.entity === "object" ? match.entity : {}) } : null;
}

export async function runMacroReference(ref, { dataManager, groupContext, status, ensureWidget, onWledDevicesChange } = {}) {
  if (!dataManager) return;
  const macro = await findMacro(dataManager, ref);
  if (!macro) {
    status?.show?.(`No macro named "${ref}".`, { type: "error", timeout: 3000 });
    return;
  }
  // Without this, a WLED action's `target` alias resolves against runMacro's
  // own `[]` default and looks "unconfigured" — fetch fresh here since a
  // Journal page has no already-loaded dashboard settings blob to read it
  // from otherwise.
  const wledDevices = await fetchWledDevices(dataManager);
  // `ensureWidget` (handout.js's own) is set only when this macro runs from
  // a Journal page rendered inside a Dashboard's Handout widget, so a
  // Journal-triggered macro can auto-add/reuse a live control surface the
  // same way the Macro board widget does — otherwise the lights/sound
  // change but nothing on screen shows it. Left undefined for Repository's
  // own standalone editor, which has no widget grid to add to.
  await runMacro(macro, { dataManager, groupContext, status, wledDevices, ensureWidget, onWledDevicesChange });
}

// Inline styles, not a CSS class — this can render inside handout.js's
// Dashboard widget, which never loads Repository's own stylesheet.
function styleAsChip(button, interactive) {
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
  button.style.cursor = interactive ? "pointer" : "default";
}

// Only gets a click handler when `interactive` is true — firing a macro is
// GM-only, same as journal-encounter.js withholding combat-start from a
// player viewing a shown-to-the-table page.
function buildMacroChip(ref, { status, interactive, dataManager, groupContext, ensureWidget, onWledDevicesChange }) {
  const button = el("button", "repository-macro-chip");
  button.type = "button";
  styleAsChip(button, interactive);
  const icon = el("span", "iconify");
  icon.dataset.icon = "tabler:bolt";
  icon.setAttribute("aria-hidden", "true");
  button.append(icon, el("span", null, `Macro: ${ref}`));
  if (interactive) {
    button.setAttribute("data-bs-toggle", "tooltip");
    button.setAttribute("data-bs-title", `Click to run "${ref}"`);
    button.addEventListener("click", () =>
      void runMacroReference(ref, { dataManager, groupContext, status, ensureWidget, onWledDevicesChange })
    );
  }
  return button;
}

// Runs after marked+DOMPurify — CommonMark's own backtick syntax already
// turned `` `macro: Haunted Forest` `` into a plain <code>...</code>; this
// just finds those and swaps each one for a chip, in place.
export function applyMacroBlocks(container, { status, interactive = false, dataManager, groupContext, ensureWidget, onWledDevicesChange } = {}) {
  container.querySelectorAll("code").forEach((codeEl) => {
    const match = MACRO_CODE_PATTERN.exec(codeEl.textContent.trim());
    if (!match) return;
    const ref = match[1].trim();
    if (!ref) return;
    codeEl.replaceWith(buildMacroChip(ref, { status, interactive, dataManager, groupContext, ensureWidget, onWledDevicesChange }));
  });
}
