// Obsidian-plugin-style inline macro triggers, same shape as journal-dice.js
// — `` `macro: Haunted Forest` `` is ordinary CommonMark inline code from
// marked's own parser (nothing special taught to it); this module finds
// those after the fact and swaps each one for a clickable chip. Resolution
// (name/id -> the actual `macro` Library record) and execution both go
// through the exact same machinery the Dashboard's own Macro board widget
// uses (common/js/lib/widgets/macro-runner.js's runMacro) — a Journal note
// is just another trigger surface for the one Macro system, not a second
// implementation of it. No page-specific context is needed to run a macro
// (unlike `` `encounter:...` ``, which needs this page's own id — see
// journal-encounter.js's own startEncounter/deterministicEncounterId), so
// this stays fully self-contained rather than routing through an
// onRunMacro callback the way encounter blocks have to.
import { fetchKindEntriesWithIds } from "../../../common/js/lib/content-fetch.js";
import { runMacro } from "../../../common/js/lib/widgets/macro-runner.js";
import { fetchWledDevices } from "../../../common/js/lib/widgets/wled.js";
import { el } from "../../../common/js/lib/dom.js";

const MACRO_CODE_PATTERN = /^macro:\s*(.+)$/i;

// Case-insensitive match against either the macro's own id or its display
// name — same "no fuzzy matching" convention journal-encounter.js's own
// findMatch establishes; an author references a macro by whichever's more
// convenient to type in a note, and an unmatched reference just fails
// clearly (see runMacroReference below) rather than guessing. Exported for
// journal-kind-reference.js's own extractContentReferences, which resolves
// a `macro:` block's own reference the exact same way when building the
// Related panel's list.
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

export async function runMacroReference(ref, { dataManager, groupContext, status, ensureWidget } = {}) {
  if (!dataManager) return;
  const macro = await findMacro(dataManager, ref);
  if (!macro) {
    status?.show?.(`No macro named "${ref}".`, { type: "error", timeout: 3000 });
    return;
  }
  // Confirmed real bug otherwise: a WLED action resolves its `target` alias
  // against wledDevices, which runMacro() defaults to `[]` when a caller
  // doesn't have one to pass — every alias looked "unconfigured" even
  // though the same macro ran fine from the Dashboard's own Macro board
  // widget (which passes its live list through). fetchWledDevices does its
  // own fresh fetch, same account-wide local+server setting the Dashboard
  // itself reads, since a Journal page (Repository directly, or the
  // Handout widget rendering one inside a Dashboard) has no
  // already-loaded dashboard settings blob to read it out of instead.
  // Fetched unconditionally (even when `ensureWidget` is also given) — a
  // live widget instance found/added via ensureWidget handles its own
  // device resolution internally, but the standalone fallback inside each
  // action handler still needs this if ensureWidget doesn't end up finding
  // one.
  const wledDevices = await fetchWledDevices(dataManager);
  // `ensureWidget` (optional) is handout.js's own — set only when this
  // macro is running from a Journal page rendered INSIDE the Handout
  // widget on a real Dashboard (dashboard.js's own ensureWidgetForMacroAction,
  // threaded through initHandoutWidget -> renderMarkdown -> here), giving
  // Journal-triggered macros the exact same "auto-add/reuse a live control
  // surface so the widget actually reflects what just happened" behavior
  // the Macro board widget already gets — confirmed real gap otherwise:
  // the lights/sound genuinely changed but nothing on screen showed it.
  // Left undefined for Repository's own standalone editor/preview, which
  // has no widget grid to add to at all — runMacro()'s own per-action
  // standalone fallbacks (each action handler's own module-level runner)
  // are what still make the macro's real-world effects happen there.
  await runMacro(macro, { dataManager, groupContext, status, wledDevices, ensureWidget });
}

// Inline styles (not just a CSS class) for the same reason markdown.js's
// own wiki-link styling and journal-dice.js's own chip use them — this can
// render inside handout.js's Dashboard widget, a page that never loads
// Repository's own stylesheet.
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

// The chip always renders (a readable "Macro: Name" summary), but only
// gets a click handler when `interactive` is true — firing a macro (WLED
// commands, broadcasting sound/handouts to the table, ...) is a GM-only
// action, same reasoning journal-encounter.js's own chip withholds
// starting combat from a player viewing a shown-to-the-table page.
function buildMacroChip(ref, { status, interactive, dataManager, groupContext, ensureWidget }) {
  const button = el("button", "repository-macro-chip");
  button.type = "button";
  styleAsChip(button, interactive);
  const icon = el("span", "iconify");
  icon.dataset.icon = "tabler:bolt";
  icon.setAttribute("aria-hidden", "true");
  button.append(icon, el("span", null, `Macro: ${ref}`));
  if (interactive) {
    button.title = `Click to run "${ref}"`;
    button.addEventListener("click", () => void runMacroReference(ref, { dataManager, groupContext, status, ensureWidget }));
  }
  return button;
}

// Runs after marked+DOMPurify — CommonMark's own backtick syntax already
// turned `` `macro: Haunted Forest` `` into a plain <code>...</code>; this
// just finds those and swaps each one for a chip, in place.
export function applyMacroBlocks(container, { status, interactive = false, dataManager, groupContext, ensureWidget } = {}) {
  container.querySelectorAll("code").forEach((codeEl) => {
    const match = MACRO_CODE_PATTERN.exec(codeEl.textContent.trim());
    if (!match) return;
    const ref = match[1].trim();
    if (!ref) return;
    codeEl.replaceWith(buildMacroChip(ref, { status, interactive, dataManager, groupContext, ensureWidget }));
  });
}
