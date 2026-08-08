// A freeform dice-expression roller for the Dashboard — the exact same
// quick-dice-button + expression-input tool Workbench's own Play/Edit "Dice"
// pane uses, not a second copy of it: the quick buttons' expression-building
// behavior (QUICK_DICE/parseQuickDiceCounts/incrementDieInExpression) and the
// roll-and-report behavior (rollExpression) both come from dice-roll.js,
// which workbench-character-view.js's own dice tool imports from too — one
// implementation of each, referenced here and there rather than duplicated.
// Only the DOM shell differs, since this mounts into a small dashboard card
// instead of Workbench's own Tools pane markup.
import { rollExpression, QUICK_DICE, parseQuickDiceCounts, incrementDieInExpression } from "./dice-roll.js";
// Rollable Journal tables — listRollableTables/describeTableRow feed this
// widget's own autocomplete and result line; the actual roll goes through
// rollExpression above exactly like a plain numeric expression does, since
// rollExpression already knows how to tell the two apart.
import { listRollableTables, describeTableRow } from "../../../../repository/js/lib/journal-tables.js";
import { preloadDiceOverlay } from "./dice-overlay.js";
import { el } from "../dom.js";

export function initDiceRollerWidget(container, { status, dataManager } = {}) {
  if (!container) {
    return { destroy() {} };
  }

  // This widget being mounted at all means dice rolling is imminent-ish —
  // warm up the 3D overlay (and the user's chosen theme, via dataManager)
  // now instead of waiting for the first actual Roll click.
  preloadDiceOverlay(dataManager);

  container.innerHTML = "";
  const wrap = el("div", "d-flex flex-column gap-2");

  // Unique per mount (not a fixed id) — nothing stops a second copy of this
  // widget existing at once (the catalog entry doesn't declare `multiple`
  // today, but nothing here should silently break if that ever changes).
  const tableListId = `diceroller-tables-${Math.random().toString(36).slice(2, 8)}`;
  const tableDatalist = document.createElement("datalist");
  tableDatalist.id = tableListId;

  const input = document.createElement("input");
  input.type = "text";
  input.className = "form-control form-control-sm";
  input.placeholder = "e.g. 2d6 + 3, or pick a rollable table below";
  input.setAttribute("list", tableListId);

  const rollButton = el("button", "btn btn-outline-primary btn-sm", "Roll");
  rollButton.type = "button";

  const resultLine = el("div", "text-body-secondary small");

  // Quick-dice buttons mutate `input.value` directly and re-sync their own
  // active/"× N" state in place — never a full re-render — so the input
  // never loses focus/caret position while the user is mid-typing an
  // expression, same as Workbench's own syncQuickDiceButtons.
  const quickGrid = el("div", "d-flex flex-wrap gap-1");
  const quickButtons = new Map();

  function syncQuickButtons() {
    const counts = parseQuickDiceCounts(input.value || "");
    quickButtons.forEach((button, die) => {
      const count = counts[die] || 0;
      if (count > 0) {
        button.textContent = `${die} × ${count}`;
        button.classList.add("btn-primary");
        button.classList.remove("btn-outline-secondary");
        button.setAttribute("aria-label", `${die} (${count} in expression)`);
      } else {
        button.textContent = die;
        button.classList.remove("btn-primary");
        button.classList.add("btn-outline-secondary");
        button.setAttribute("aria-label", `Add ${die}`);
      }
    });
  }

  QUICK_DICE.forEach((die) => {
    const button = el("button", "btn btn-outline-secondary btn-sm", die);
    button.type = "button";
    button.addEventListener("click", () => {
      input.value = incrementDieInExpression(die, input.value || "");
      syncQuickButtons();
      input.focus();
    });
    quickButtons.set(die, button);
    quickGrid.appendChild(button);
  });

  const clearButton = el("button", "btn btn-outline-secondary btn-sm", "Clear");
  clearButton.type = "button";
  clearButton.setAttribute("aria-label", "Clear dice expression");
  clearButton.addEventListener("click", () => {
    input.value = "";
    syncQuickButtons();
    input.focus();
  });
  quickGrid.appendChild(clearButton);

  async function commitRoll() {
    const expression = input.value.trim();
    if (!expression) return;
    const rolled = await rollExpression(expression, { status, dataManager });
    if (!rolled) return;
    // Table rolls skip the "pageTitle (dN) →" prefix — the expression
    // that was rolled is already sitting right there in the input above,
    // so just the number/result is what's actually new information.
    resultLine.textContent = rolled.isTable ? describeTableRow(rolled.row) : `${rolled.expression} → ${rolled.total}`;
  }

  // Populated once on mount — a table named after this widget was already
  // showing wouldn't appear until the next mount either way, same "not
  // live-updated" tradeoff every other one-shot autocomplete in this suite
  // accepts (e.g. Handout's own picker lists).
  async function populateTableAutocomplete() {
    if (!dataManager) return;
    const tables = await listRollableTables(dataManager).catch(() => []);
    tableDatalist.innerHTML = "";
    tables.forEach(({ pageTitle, blockId }) => {
      const option = document.createElement("option");
      option.value = `[[${pageTitle}#^${blockId}]]`;
      option.label = `${pageTitle} — ${blockId}`;
      tableDatalist.appendChild(option);
    });
  }
  void populateTableAutocomplete();

  input.addEventListener("input", syncQuickButtons);
  input.addEventListener("keydown", (event) => {
    if (event.key === "Enter") {
      event.preventDefault();
      void commitRoll();
    }
  });
  rollButton.addEventListener("click", () => void commitRoll());

  const inputRow = el("div", "d-flex gap-2");
  inputRow.append(input, rollButton);

  wrap.append(quickGrid, inputRow, resultLine, tableDatalist);
  container.appendChild(wrap);

  return {
    destroy() {
      container.innerHTML = "";
    },
  };
}

// --- Macro action support (common/js/lib/widgets/macro-runner.js) ---
// rollExpression is already standalone given just dataManager — no mounted
// Dice Roller widget instance required. `announce` just flips on
// rollExpression's own broadcast option (see dice-roll.js).

export const DICEROLLER_MACRO_ACTIONS = {
  roll: { label: "Roll an expression", params: ["expression", "announce"] },
};

export async function runDiceRollerMacroAction(action, { dataManager, groupContext, status } = {}) {
  const params = action?.params || {};
  const expression = String(params.expression || "").trim();
  if (!expression) {
    throw new Error("No dice expression given.");
  }
  const result = await rollExpression(expression, {
    status,
    dataManager,
    groupContext,
    broadcast: Boolean(params.announce),
  });
  if (!result) {
    throw new Error(`Unable to roll "${expression}".`);
  }
}
