// A freeform dice-expression roller for the Dashboard — the exact same
// quick-dice-button + expression-input tool Workbench's own Play/Edit "Dice"
// pane uses, not a second copy of it: the quick buttons' expression-building
// behavior (resolveQuickDice/parseQuickDiceCounts/incrementDieInExpression)
// and the roll-and-report behavior (rollExpression) both come from dice-roll.js,
// which workbench-character-view.js's own dice tool imports from too — one
// implementation of each, referenced here and there rather than duplicated.
// Only the DOM shell differs, since this mounts into a small dashboard card
// instead of Workbench's own Tools pane markup.
//
// This is also the ONE Dashboard home for a System's own Rolls/Moves and
// Tier-3 symbol-dice pool, mirroring Workbench's own Dice pane — Dashboard's
// separate Character widget (character-sheet.js) is scoped to a character's
// combat-bound Role fields (resource/value/tags/modifier) and stays that way;
// Rolls/symbol dice are a System-level dice-rolling concept, not a
// combat-binding one, so they belong here, not there.
import {
  rollExpression,
  resolveActiveDice,
  resolveQuickDice,
  parseQuickDiceCounts,
  incrementDieInExpression,
  extractSystemRolls,
  extractSystemSymbolDice,
  rollSystemMove,
} from "./dice-roll.js";
import { rollSymbolDicePool, formatSymbolPoolResult } from "../../../../workbench/js/lib/symbol-dice.js";
// Rollable Journal tables — listRollableTables/describeTableRow feed this
// widget's own autocomplete and result line; the actual roll goes through
// rollExpression above exactly like a plain numeric expression does, since
// rollExpression already knows how to tell the two apart.
import { listRollableTables, describeTableRow } from "../../../../repository/js/lib/journal-tables.js";
import { preloadDiceOverlay } from "./dice-overlay.js";
import { createIconButton } from "../ui-components.js";
import { refreshTooltips, disposeTooltips } from "../tooltips.js";
import { el, setElementVisible } from "../dom.js";

export function initDiceRollerWidget(container, { status, dataManager, groupContext = null } = {}) {
  if (!container) {
    return { destroy() {} };
  }

  // This widget being mounted at all means dice rolling is imminent-ish —
  // warm up the 3D overlay (and the user's chosen theme, via dataManager)
  // now instead of waiting for the first actual Roll click.
  preloadDiceOverlay(dataManager);

  // Section 2's active-System resolution — the Dashboard has no single
  // "current character" of its own (unlike Character Sheet/Workbench), so
  // only the active campaign Group's own System (if any) can override the
  // standard 7 here; resolved once on mount, same "one fetch, then render"
  // shape as populateTableAutocomplete below.
  let activeDice = [];
  // Section 1.3/4's named Rolls/Moves — same resolution as activeDice above.
  let activeSystemRolls = [];
  // Section 1.4/3.4's Tier-3 symbol dice (Phase 5) — same resolution too. A
  // System whose "dice" are ALL symbol dice (Genesys) makes extractSystemDice
  // return empty, which resolveQuickDice then falls back to the standard 7
  // for — wrong for a narrative dice-pool System, so this widget swaps to
  // the symbol-pool stepper instead of showing that incorrect fallback grid
  // (see toggleSymbolMode below).
  let activeSymbolDice = [];
  const symbolPoolCounts = new Map();

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

  function syncQuickButtons() {
    const counts = parseQuickDiceCounts(input.value || "", activeDice);
    quickButtons.forEach((button, id) => {
      const count = counts[id] || 0;
      if (count > 0) {
        button.textContent = `${button.dataset.dieLabel} × ${count}`;
        button.classList.add("btn-primary");
        button.classList.remove("btn-outline-secondary");
        button.setAttribute("aria-label", `${button.dataset.dieLabel} (${count} in expression)`);
      } else {
        button.textContent = button.dataset.dieLabel;
        button.classList.remove("btn-primary");
        button.classList.add("btn-outline-secondary");
        button.setAttribute("aria-label", `Add ${button.dataset.dieLabel}`);
      }
    });
  }

  async function commitRoll() {
    const expression = input.value.trim();
    if (!expression) return;
    const rolled = await rollExpression(expression, { status, dataManager, dice: activeDice });
    if (!rolled) return;
    // Table rolls skip the "pageTitle (dN) →" prefix — the expression
    // that was rolled is already sitting right there in the input above,
    // so just the number/result is what's actually new information.
    resultLine.textContent = rolled.isTable ? describeTableRow(rolled.row) : `${rolled.expression} → ${rolled.total}`;
  }

  // Clear (red eraser icon, no text) — always the FIRST control in the row,
  // ahead of the dice buttons that follow it, since it acts on all of them
  // (whatever's currently in the expression input).
  const clearButton = createIconButton({
    icon: "tabler:eraser",
    label: "Clear dice expression",
    variant: "outline-danger",
    onClick: () => {
      input.value = "";
      syncQuickButtons();
      input.focus();
    },
  });

  // Quick-dice buttons mutate `input.value` directly and re-sync their own
  // active/"× N" state in place — never a full re-render — so the input
  // never loses focus/caret position while the user is mid-typing an
  // expression, same as Workbench's own syncQuickDiceButtons.
  const quickGrid = el("div", "d-flex flex-wrap gap-1");
  const quickButtons = new Map();
  quickGrid.appendChild(clearButton);

  // Rebuilt whenever the resolved active System's dice change (see
  // loadActiveDice below) — a System's own dice (Section 1.1) replace the
  // standard 7 entirely rather than appending to them (Section 5).
  function renderQuickButtons() {
    quickButtons.forEach((button) => button.remove());
    quickButtons.clear();
    activeDice.forEach((die) => {
      const button = el("button", "btn btn-outline-secondary btn-sm", die.label || die.id);
      button.type = "button";
      button.dataset.dieLabel = die.label || die.id;
      button.addEventListener("click", () => {
        input.value = incrementDieInExpression(die.id, input.value || "");
        syncQuickButtons();
        input.focus();
      });
      quickButtons.set(die.id, button);
      quickGrid.appendChild(button);
    });
    syncQuickButtons();
  }

  const inputRow = el("div", "d-flex gap-2");
  inputRow.append(input, rollButton);

  // Named Rolls/Moves (Section 1.3/4) — a SEPARATE row below the expression
  // input/Roll button, not mixed in with the quick-dice grid above it: a
  // quick-dice button only ever edits the expression string (nothing rolls
  // until Roll is clicked), while a Move button is a one-click roller in its
  // own right — visually grouping it with the input it has nothing to do
  // with was confusing. Hidden entirely (nothing rendered) for the common
  // case of a System with no "rolls" field.
  const movesRow = el("div", "d-flex flex-wrap gap-1");
  const moveButtons = new Map();

  function renderMoveButtons() {
    moveButtons.forEach((button) => button.remove());
    moveButtons.clear();
    activeSystemRolls.forEach((move, index) => {
      const button = el("button", "btn btn-outline-primary btn-sm", move.label);
      button.type = "button";
      button.setAttribute("aria-label", `Roll ${move.label}`);
      if (move.expression) button.title = move.expression;
      button.addEventListener("click", () => void rollMove(move));
      moveButtons.set(index, button);
      movesRow.appendChild(button);
    });
    setElementVisible(movesRow, activeSystemRolls.length > 0, "flex");
  }

  // Rolls a System-defined Move (Section 1.3/4) — broadcasts to the active
  // campaign's Game Log via rollSystemMove's own built-in broadcast, same as
  // Workbench's/Character Sheet's own Moves: a Move is a meaningful, named
  // action the rest of the group cares about, unlike this widget's own
  // freeform commitRoll above (which never broadcasts).
  async function rollMove(move) {
    const rolled = await rollSystemMove(move, {
      status,
      dataManager,
      dice: activeDice,
      broadcast: true,
      groupContext,
    });
    if (!rolled || rolled.isTable) return;
    const verdictText = rolled.verdict?.label ? ` — ${rolled.verdict.label}` : "";
    resultLine.textContent = `${move.label}: ${rolled.total}${verdictText}`;
  }

  // Everything above (quick-dice grid, expression input/Roll, Moves) is the
  // "standard" numeric-dice UI — grouped so toggleSymbolMode below can swap
  // the whole thing out at once for a System whose dice are all Tier-3
  // symbol dice (Section 1.4/3.4), same approach Workbench's own Dice pane
  // uses.
  const standardSection = el("div", "d-flex flex-column gap-2");
  standardSection.append(quickGrid, inputRow, movesRow);

  // Tier-3 symbol-dice pool (Section 1.4/3.4/6.3, Phase 5) — replaces
  // standardSection entirely (toggleSymbolMode below) for a System whose
  // dice are all symbol dice. Never broadcast, matching this widget's own
  // plain-expression rolls (commitRoll above).
  const symbolLabel = el("span", "small text-body-secondary", "Dice Pool");
  const symbolSteppers = el("div", "d-flex flex-column gap-2");
  const symbolRollButton = el("button", "btn btn-outline-primary btn-sm align-self-start", "Roll pool");
  symbolRollButton.type = "button";
  const symbolSection = el("div", "d-flex flex-column gap-2");
  symbolSection.append(symbolLabel, symbolSteppers, symbolRollButton);

  function renderSymbolPool() {
    symbolSteppers.innerHTML = "";
    activeSymbolDice.forEach((die) => {
      const row = el("div", "d-flex align-items-center gap-2");
      row.appendChild(el("span", "small flex-grow-1", die.label));
      const minus = el("button", "btn btn-outline-secondary btn-sm", "−");
      minus.type = "button";
      minus.setAttribute("aria-label", `Remove one ${die.label}`);
      const countSpan = el("span", "text-center", String(symbolPoolCounts.get(die.id) || 0));
      countSpan.style.minWidth = "1.5rem";
      const plus = el("button", "btn btn-outline-secondary btn-sm", "+");
      plus.type = "button";
      plus.setAttribute("aria-label", `Add one ${die.label}`);
      minus.addEventListener("click", () => {
        const next = Math.max(0, (symbolPoolCounts.get(die.id) || 0) - 1);
        symbolPoolCounts.set(die.id, next);
        countSpan.textContent = String(next);
      });
      plus.addEventListener("click", () => {
        const next = (symbolPoolCounts.get(die.id) || 0) + 1;
        symbolPoolCounts.set(die.id, next);
        countSpan.textContent = String(next);
      });
      row.append(minus, countSpan, plus);
      symbolSteppers.appendChild(row);
    });
  }

  // Swaps standardSection <-> symbolSection — NOT via `.hidden`, which
  // silently does nothing here: both containers carry Bootstrap's `.d-flex`
  // (declared `!important`), which always beats the `[hidden]` UA rule
  // regardless of specificity, so the "hidden" side never actually
  // collapsed (this is exactly why Roll and Roll pool could both show at
  // once for a plain-numeric System like Daggerheart). See dom.js's own
  // setElementVisible for the real fix.
  function toggleSymbolMode() {
    const symbolMode = activeSymbolDice.length > 0;
    setElementVisible(standardSection, !symbolMode, "flex");
    setElementVisible(symbolSection, symbolMode, "flex");
  }

  function executeSymbolPoolRoll() {
    const diceById = new Map(activeSymbolDice.map((die) => [die.id.toLowerCase(), die]));
    const poolCounts = activeSymbolDice
      .map((die) => ({ dieId: die.id, count: symbolPoolCounts.get(die.id) || 0 }))
      .filter((entry) => entry.count > 0);
    if (!poolCounts.length) {
      status?.show("Add at least one die to the pool first.", { type: "info", timeout: 2000 });
      return;
    }
    const rolled = rollSymbolDicePool(poolCounts, { diceById });
    resultLine.textContent = formatSymbolPoolResult(rolled.net);
  }
  symbolRollButton.addEventListener("click", executeSymbolPoolRoll);

  async function loadActiveDice() {
    const systemDefinition = await resolveActiveDice({ dataManager, groupContext }).catch(() => null);
    activeDice = resolveQuickDice({ systemDefinition });
    activeSystemRolls = extractSystemRolls(systemDefinition);
    activeSymbolDice = extractSystemSymbolDice(systemDefinition);
    renderQuickButtons();
    renderMoveButtons();
    renderSymbolPool();
    toggleSymbolMode();
  }

  activeDice = resolveQuickDice({});
  renderQuickButtons();
  toggleSymbolMode();
  void loadActiveDice();

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

  wrap.append(standardSection, symbolSection, resultLine, tableDatalist);
  container.appendChild(wrap);
  refreshTooltips(container);

  return {
    destroy() {
      disposeTooltips(container);
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
