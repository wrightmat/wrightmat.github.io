// Obsidian-plugin-style inline dice rollers. The syntax is just ordinary
// CommonMark inline code — `` `dice:1d4` `` renders as an unremarkable
// `<code>dice:1d4</code>` from marked's own parser, nothing special has to
// be taught to it — this module simply finds those after the fact and
// swaps each one for a live "3 (1d4) [dice icon]" widget. Both the silent
// starting value and every click-triggered reroll go through the exact same
// dice engine (dice-roll.js's rollExpression) the Dice Roller dashboard
// widget and Character Sheet's Initiative button already use — one engine,
// not a second copy of it.
//
// `` `dice:[[Page#^blockId]]` `` — the same syntax, but a rollable named
// table reference (journal-tables.js) instead of a numeric expression;
// rollExpression itself already knows how to tell the two apart.
import { rollExpression } from "../../../common/js/lib/widgets/dice-roll.js";
import { rollDiceExpression } from "../../../workbench/js/lib/dice.js";
import { parseTableReferenceExpression, describeTableRow } from "./journal-tables.js";
import { el } from "../../../common/js/lib/dom.js";

const DICE_CODE_PATTERN = /^dice:\s*(.+)$/i;

// The chip's starting number, before anyone's clicked it — a real random
// roll of the expression (same engine as an actual click), just silent: no
// status toast, no visible "roll" moment, it just *starts* already rolled.
// Falls back to 0 for an expression the engine can't parse rather than
// throwing and breaking the whole render. Only ever called for a plain
// numeric expression — a table reference has no synchronous starting value
// (it needs a fetch), see buildDiceRoller's own async resolution instead.
function rollSilently(expression) {
  try {
    return rollDiceExpression(expression).total;
  } catch (error) {
    return 0;
  }
}

// Inline styles (not just a CSS class) for the same reason markdown.js's
// own wiki-link styling uses them — this can render inside handout.js's
// Dashboard widget, a page that never loads Repository's own stylesheet.
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

// The chip always renders and always resolves to a real value (not raw
// `dice:` code text) — only the click-to-reroll handler is conditional on
// `interactive`. Rolling dice is otherwise harmless for anyone to trigger,
// but Handout's read-only Dashboard rendering still needs to withhold it for
// a player/shared viewer for the same reason it withholds `encounter:`
// blocks: consistency ("only the GM should be able to ... roll dice"), not
// because a re-roll itself is unsafe.
//
// A table reference (`tableRef` non-null) has no synchronous starting value
// the way a plain expression does — resolving one means fetching the
// referenced Journal page, so the chip mounts showing "…" and resolves once
// via the same rollExpression path a click would use, then behaves like any
// other chip from then on.
function buildDiceRoller(expression, { status, interactive, dataManager }) {
  const tableRef = parseTableReferenceExpression(expression);
  const button = el("button", "repository-dice-roller");
  button.type = "button";
  styleAsChip(button, interactive);
  const valueEl = el(
    "span",
    "repository-dice-roller-value fw-semibold",
    tableRef ? "…" : String(rollSilently(expression))
  );
  const icon = el("span", "iconify repository-dice-roller-icon");
  icon.dataset.icon = "tabler:dice-5";
  icon.setAttribute("aria-hidden", "true");
  button.append(valueEl, document.createTextNode(" "));
  // Table rolls skip the "(expression)" span entirely — the block id is
  // already in the tooltip below (and visible as plain text in Edit mode),
  // so repeating it here just adds noise around the number/result that's
  // the actually useful part. Plain dice expressions keep it, since there's
  // no other visible copy of what was rolled.
  if (!tableRef) {
    button.append(el("span", "repository-dice-roller-expression", `(${expression})`), document.createTextNode(" "));
  }
  button.append(icon);

  async function performRoll() {
    const outcome = await rollExpression(expression, { status, label: "Journal", dataManager });
    if (!outcome) {
      if (tableRef) valueEl.textContent = "—";
      return;
    }
    valueEl.textContent = outcome.isTable ? describeTableRow(outcome.row) : String(outcome.total);
  }

  if (tableRef) {
    void performRoll();
  }
  if (interactive) {
    button.title = tableRef ? `Click to reroll on "${tableRef.blockId}"` : `Click to roll ${expression}`;
    // Clicking anywhere in the button (the value, the expression, or the
    // icon) rolls — one click target, not separate handlers per piece, so
    // there's no dead zone between them.
    button.addEventListener("click", () => void performRoll());
  }
  return button;
}

// Runs after marked+DOMPurify — CommonMark's own backtick syntax already
// turned `` `dice:1d4` `` into a plain <code>dice:1d4</code>; this just
// finds those and swaps each one for a live roller, in place.
export function applyDiceRollers(container, { status, interactive = false, dataManager } = {}) {
  container.querySelectorAll("code").forEach((codeEl) => {
    const match = DICE_CODE_PATTERN.exec(codeEl.textContent.trim());
    if (!match) return;
    const expression = match[1].trim();
    if (!expression) return;
    codeEl.replaceWith(buildDiceRoller(expression, { status, interactive, dataManager }));
  });
}
