// Obsidian-style inline dice rollers — `` `dice:1d4` `` is ordinary
// CommonMark inline code; this finds those after the fact and swaps each
// for a live "3 (1d4) [dice icon]" widget. Both the silent starting value
// and every click-triggered reroll go through the same rollExpression
// (dice-roll.js) the Dice Roller widget and Initiative button use.
//
// `` `dice:[[Page#^blockId]]` `` is the same syntax but a rollable named
// table reference (journal-tables.js) — rollExpression tells them apart.
import { rollExpression } from "../../../common/js/lib/widgets/dice-roll.js";
import { preloadDiceOverlay } from "../../../common/js/lib/widgets/dice-overlay.js";
import { rollDiceExpression } from "../../../workbench/js/lib/dice.js";
import { parseTableReferenceExpression, resolveTableReference, describeTableRow } from "./journal-tables.js";
import { el } from "../../../common/js/lib/dom.js";

const DICE_CODE_PATTERN = /^dice:\s*(.+)$/i;

// The chip's starting number — a real roll, just silent (no toast). Falls
// back to 0 rather than throwing and breaking the render. Only for a plain
// numeric expression — a table reference has no synchronous starting value
// (needs a fetch), see buildDiceRoller's async resolution instead.
function rollSilently(expression) {
  try {
    return rollDiceExpression(expression).total;
  } catch (error) {
    return 0;
  }
}

// Same "starts already rolled, no toast" convention as rollSilently above,
// just async (a table reference needs to fetch the referenced Journal
// page). Deliberately bypasses rollExpression here — going through it would
// toast on every page load, not just on an actual click. The click-to-reroll
// handler in buildDiceRoller below still goes through performRoll/
// rollExpression — that one is a deliberate action and should stay loud.
async function resolveTableSilently(dataManager, tableRef) {
  if (!dataManager) return null;
  try {
    return await resolveTableReference(dataManager, tableRef);
  } catch (error) {
    return null;
  }
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

// The chip always renders resolved (not raw `dice:` text) — only the
// click-to-reroll handler is conditional on `interactive`. Rolling dice is
// harmless, but Handout's read-only rendering withholds it from a shared
// viewer for consistency with `encounter:` blocks, not because a reroll is
// unsafe.
//
// A table reference has no synchronous starting value — resolving one means
// fetching the referenced Journal page, so the chip mounts showing "…" and
// resolves once, then behaves like any other chip.
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
    void (async () => {
      const outcome = await resolveTableSilently(dataManager, tableRef);
      valueEl.textContent = outcome ? describeTableRow(outcome.row) : "—";
    })();
  }
  if (interactive) {
    button.setAttribute("data-bs-toggle", "tooltip");
    button.setAttribute("data-bs-title", tableRef ? `Click to reroll on "${tableRef.blockId}"` : `Click to roll ${expression}`);
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
  // Only interactive rollers can actually be clicked (see buildDiceRoller's
  // own `if (interactive)` below) — a read-only render's silent starting
  // values never touch the overlay, so there's nothing worth warming up.
  if (interactive) {
    preloadDiceOverlay(dataManager);
  }
  container.querySelectorAll("code").forEach((codeEl) => {
    const match = DICE_CODE_PATTERN.exec(codeEl.textContent.trim());
    if (!match) return;
    const expression = match[1].trim();
    if (!expression) return;
    codeEl.replaceWith(buildDiceRoller(expression, { status, interactive, dataManager }));
  });
}
