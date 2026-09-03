// A freeform dice-expression roller for the Dashboard — the same quick-dice-
// button + expression-input tool Workbench's Play/Edit "Dice" pane uses, not
// a second copy: the quick-button behavior and roll-and-report behavior both
// come from dice-roll.js. Only the DOM shell differs (a small dashboard card
// instead of Workbench's Tools pane markup).
//
// Also the one Dashboard home for a System's own Rolls/Moves and Tier-3
// symbol-dice pool — Dashboard's separate Character widget stays scoped to a
// character's combat-bound Role fields; Rolls/symbol dice are a System-level
// concept, not a combat-binding one.
import {
  rollExpression,
  resolveActiveDice,
  resolveQuickDice,
  parseQuickDiceCounts,
  incrementDieInExpression,
  extractSystemRolls,
  extractSystemSymbolDice,
  rollSystemMove,
  rollSymbolPoolExpression,
} from "./dice-roll.js";
import { formatSymbolPoolResult } from "../../../../workbench/js/lib/symbol-dice.js";
import { listRollableTables, describeTableRow } from "../../../../repository/js/lib/journal-tables.js";
import { preloadDiceOverlay } from "./dice-overlay.js";
import { createIconButton, createModeToggleGroup } from "../ui-components.js";
import { refreshTooltips, disposeTooltips } from "../tooltips.js";
import { el, setElementVisible } from "../dom.js";

export function initDiceRollerWidget(container, { status, dataManager, groupContext = null } = {}) {
  if (!container) {
    return { destroy() {} };
  }

  // Default/Broadcast/Private is purely additive: "Default" leaves every
  // button's existing behavior untouched (a Move still auto-broadcasts, a
  // plain roll stays local). "Broadcast" is GM-only (`access === "owner"`,
  // same convention as Map's visibility toggle). "Private" is a self-whisper
  // (recipientIds: [currentUserId]), reusing Game Log's whisper mechanism.
  let mode = "default";
  const currentUserId = dataManager?.session?.user?.id ?? null;
  const isGm = groupContext?.access === "owner";

  // `defaultBroadcast` is whatever this specific action already does today
  // (true for Moves, false for plain/symbol rolls) — preserved byte-for-byte
  // when mode is "default".
  function resolveVisibility(defaultBroadcast) {
    if (mode === "private") {
      return { broadcast: false, recipientIds: currentUserId != null ? [currentUserId] : undefined };
    }
    if (mode === "broadcast" && isGm) {
      return { broadcast: true, recipientIds: undefined };
    }
    return { broadcast: defaultBroadcast, recipientIds: undefined };
  }

  // Fires the "show this on everyone's screen" broadcast after a successful
  // roll (separate from resolveVisibility, which only controls the log
  // entry's own visibility, since the result isn't known until the roll
  // resolves). `dieResults` are the real physically-rolled per-die values —
  // required, since dice-box can't force a remote roll onto a chosen result;
  // a roll that fell through to the plain Math.random path has none and
  // simply can't broadcast a visual reveal (the log entry still posts).
  function maybeBroadcastRoll(label, total, dieResults) {
    if (mode !== "broadcast" || !isGm || !dataManager || !groupContext?.groupId) return;
    if (!Array.isArray(dieResults) || !dieResults.length) return;
    void dataManager
      .postDiceRollBroadcast({ groupId: groupContext.groupId, label, total, dieResults })
      .catch((error) => console.warn("[dice-roller] Broadcast failed", error));
  }

  const modeToggleContainer = el("div");
  function renderModeToggle() {
    createModeToggleGroup({
      container: modeToggleContainer,
      ariaLabel: "Roll visibility",
      value: mode,
      options: [
        { value: "default", label: "Default", icon: "tabler:dice-5" },
        {
          value: "broadcast",
          label: "Broadcast",
          icon: "tabler:broadcast",
          disabled: !isGm,
          tooltip: isGm ? "Show this roll animating on everyone's screen" : "GM only",
        },
        { value: "private", label: "Private", icon: "tabler:eye-off", tooltip: "Only you see this roll" },
      ],
      onChange: (next) => {
        mode = next;
        renderModeToggle();
      },
    });
  }

  preloadDiceOverlay(dataManager);

  // The Dashboard has no single "current character" (unlike Workbench), so
  // only the active campaign Group's own System can override the standard 7.
  let activeDice = [];
  let activeSystemRolls = [];
  // A System whose dice are ALL symbol dice (Genesys) makes extractSystemDice
  // return empty, which resolveQuickDice would fall back to the standard 7
  // for — wrong for a narrative dice-pool System, so this widget swaps to the
  // symbol-pool stepper instead (see toggleSymbolMode below).
  let activeSymbolDice = [];
  const symbolPoolCounts = new Map();

  container.innerHTML = "";
  const wrap = el("div", "d-flex flex-column gap-2");

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
    const rolled = await rollExpression(expression, {
      status,
      dataManager,
      dice: activeDice,
      groupContext,
      ...resolveVisibility(false),
    });
    if (!rolled) return;
    resultLine.textContent = rolled.isTable ? describeTableRow(rolled.row) : `${rolled.expression} → ${rolled.total}`;
    if (!rolled.isTable) maybeBroadcastRoll("", rolled.total, rolled.result?.dieResults);
  }

  // Clear is always first in the row, ahead of the dice buttons, since it
  // acts on all of them.
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

  // Quick-dice buttons mutate input.value directly and re-sync their own
  // active/"× N" state in place — never a full re-render — so the input
  // never loses focus/caret while the user is mid-typing.
  const quickGrid = el("div", "d-flex flex-wrap gap-1");
  const quickButtons = new Map();
  quickGrid.appendChild(clearButton);

  // A System's own dice replace the standard 7 entirely rather than
  // appending to them.
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

  // A separate row below the expression input — a quick-dice button only
  // edits the expression string, while a Move button is a one-click roller
  // in its own right. Hidden entirely for a System with no "rolls" field.
  const movesRow = el("div", "d-flex flex-wrap gap-1");
  const moveButtons = new Map();

  function renderMoveButtons() {
    disposeTooltips(movesRow);
    moveButtons.forEach((button) => button.remove());
    moveButtons.clear();
    activeSystemRolls.forEach((move, index) => {
      const button = el("button", "btn btn-outline-primary btn-sm", move.label);
      button.type = "button";
      button.setAttribute("aria-label", `Roll ${move.label}`);
      if (move.expression) {
        button.setAttribute("data-bs-toggle", "tooltip");
        button.setAttribute("data-bs-title", move.expression);
      }
      button.addEventListener("click", () => void rollMove(move));
      moveButtons.set(index, button);
      movesRow.appendChild(button);
    });
    refreshTooltips(movesRow);
    setElementVisible(movesRow, activeSystemRolls.length > 0, "flex");
  }

  // Broadcasts to the active campaign's Game Log via rollSystemMove's own
  // built-in broadcast — a Move is a meaningful, named action the group
  // cares about, unlike commitRoll's freeform roll, which never broadcasts.
  async function rollMove(move) {
    const rolled = await rollSystemMove(move, {
      status,
      dataManager,
      dice: activeDice,
      groupContext,
      ...resolveVisibility(true),
    });
    if (!rolled || rolled.isTable) return;
    const verdictText = rolled.verdict?.label ? ` — ${rolled.verdict.label}` : "";
    resultLine.textContent = `${move.label}: ${rolled.total}${verdictText}`;
    maybeBroadcastRoll(move.label, rolled.total, rolled.result?.dieResults);
  }

  // Quick-dice grid, expression input/Roll, and Moves are the "standard"
  // numeric-dice UI — grouped so toggleSymbolMode can swap the whole thing
  // out for a System whose dice are all Tier-3 symbol dice.
  const standardSection = el("div", "d-flex flex-column gap-2");
  standardSection.append(quickGrid, inputRow, movesRow);

  // Never broadcast, matching this widget's own plain-expression rolls.
  const symbolLabel = el("span", "small text-body-secondary", "Dice Pool");
  const symbolSteppers = el("div", "d-flex flex-column gap-2");
  const symbolRollButton = el("button", "btn btn-outline-primary btn-sm align-self-start", "Roll pool");
  symbolRollButton.type = "button";
  const symbolSection = el("div", "d-flex flex-column gap-2");
  symbolSection.append(symbolLabel, symbolSteppers, symbolRollButton);

  function renderSymbolPool() {
    disposeTooltips(symbolSteppers);
    symbolSteppers.innerHTML = "";
    activeSymbolDice.forEach((die) => {
      const row = el("div", "d-flex align-items-center gap-2");
      row.appendChild(el("span", "small flex-grow-1", die.label));
      const minus = el("button", "btn btn-outline-secondary btn-sm", "−");
      minus.type = "button";
      minus.setAttribute("aria-label", `Remove one ${die.label}`);
      minus.setAttribute("data-bs-toggle", "tooltip");
      minus.setAttribute("data-bs-title", `Remove one ${die.label}`);
      const countSpan = el("span", "text-center", String(symbolPoolCounts.get(die.id) || 0));
      countSpan.style.minWidth = "1.5rem";
      const plus = el("button", "btn btn-outline-secondary btn-sm", "+");
      plus.type = "button";
      plus.setAttribute("aria-label", `Add one ${die.label}`);
      plus.setAttribute("data-bs-toggle", "tooltip");
      plus.setAttribute("data-bs-title", `Add one ${die.label}`);
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
    refreshTooltips(symbolSteppers);
  }

  // Swaps standardSection <-> symbolSection via setElementVisible, never
  // `.hidden` — both containers carry Bootstrap's `.d-flex` (`!important`),
  // which always beats the `[hidden]` UA rule regardless of specificity, so
  // a plain `.hidden` toggle wouldn't actually collapse either side.
  function toggleSymbolMode() {
    const symbolMode = activeSymbolDice.length > 0;
    setElementVisible(standardSection, !symbolMode, "flex");
    setElementVisible(symbolSection, symbolMode, "flex");
  }

  async function executeSymbolPoolRoll() {
    const diceById = new Map(activeSymbolDice.map((die) => [die.id.toLowerCase(), die]));
    const poolCounts = activeSymbolDice
      .map((die) => ({ dieId: die.id, count: symbolPoolCounts.get(die.id) || 0 }))
      .filter((entry) => entry.count > 0);
    if (!poolCounts.length) {
      status?.show("Add at least one die to the pool first.", { type: "info", timeout: 2000 });
      return;
    }
    const notation = poolCounts
      .map(({ dieId, count }) => `${count} ${diceById.get(dieId.toLowerCase())?.label || dieId}`)
      .join(" + ");
    const rolled = await rollSymbolPoolExpression(poolCounts, {
      diceById,
      dataManager,
      groupContext,
      label: "Dice Pool",
      notation,
      ...resolveVisibility(false),
    });
    resultLine.textContent = formatSymbolPoolResult(rolled.net);
    // No visual reveal — symbol-dice faces don't fit dice-reveal.js's plain
    // numeric tile shape; the log entry above still posts normally.
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

  renderModeToggle();
  wrap.append(modeToggleContainer, standardSection, symbolSection, resultLine, tableDatalist);
  container.appendChild(wrap);
  refreshTooltips(container);

  return {
    destroy() {
      disposeTooltips(container);
      container.innerHTML = "";
    },
  };
}

// rollExpression is standalone given just dataManager — no mounted Dice
// Roller widget instance required.
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
