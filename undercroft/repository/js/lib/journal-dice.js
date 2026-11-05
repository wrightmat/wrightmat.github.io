// Obsidian-style inline dice rollers — `` `dice:1d4` `` is ordinary
// CommonMark inline code; this finds those after the fact and swaps each
// for a live "3 (1d4) [dice icon]" widget. Both the silent starting value
// and every click-triggered reroll go through the same rollExpression
// (dice-roll.js) the Dice Roller widget and Initiative button use.
//
// `` `dice:[[Page#^blockId]]` `` is the same syntax but a rollable named
// table reference (journal-tables.js) — rollExpression tells them apart.
import { rollExpression, expandRollTerm } from "../../../common/js/lib/widgets/dice-roll.js";
import { preloadDiceOverlay } from "../../../common/js/lib/widgets/dice-overlay.js";
import { rollDiceExpression } from "../../../workbench/js/lib/dice.js";
import { parseTableReferenceExpression, resolveTableReference, describeTableRow } from "./journal-tables.js";
import { el } from "../../../common/js/lib/dom.js";

const DICE_CODE_PATTERN = /^dice:\s*(.+)$/i;

// The chip's starting number — a real roll, just silent (no toast). Falls
// back to 0 rather than throwing and breaking the render. Only for a plain
// numeric expression — a table reference has no synchronous starting value
// (needs a fetch), see buildDiceRoller's async resolution instead.
function rollSilently(expression, rolls, dice) {
  try {
    // A System roll's shortName stands in for its own dice, same as when the click rolls it.
    const composed = expandRollTerm(expression, rolls, dice);
    return rollDiceExpression(composed ? composed.expression : expression).total;
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

// Shared look: shell.css's .inline-ref (an underline in the kind's own color, so the text keeps the surrounding style).
function styleAsChip(button) {
  button.classList.add("inline-ref", "inline-ref--dice");
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
function buildDiceRoller(
  expression,
  { status, interactive, dataManager, initialValue, label = "Journal", rolls, dice, showValue = true, context, displayText = "" }
) {
  const tableRef = parseTableReferenceExpression(expression);
  const button = el("button", "repository-dice-roller");
  button.type = "button";
  styleAsChip(button);
  // Notation found in plain prose is only the dice themselves — no number until the person clicks. An authored
  // `dice:` tag starts with a value, which a click rerolls.
  if (!showValue && !tableRef) {
    const shown = displayText || expression;
    button.append(initialValue ? `${initialValue} (${shown})` : shown);
    return wireRoll(button, expression, { status, interactive, dataManager, label, rolls, dice, tableRef, valueEl: null, context, displayText: shown });
  }
  const valueEl = el(
    "span",
    "repository-dice-roller-value fw-semibold",
    tableRef ? "…" : initialValue ?? String(rollSilently(expression, rolls, dice))
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
  return wireRoll(button, expression, { status, interactive, dataManager, label, rolls, dice, tableRef, valueEl });
}

function wireRoll(button, expression, { status, interactive, dataManager, label, rolls, dice, tableRef, valueEl, context, displayText }) {
  async function performRoll() {
    const outcome = await rollExpression(expression, { status, label, dataManager, rolls, dice, context: context || {} });
    if (!valueEl) return;
    if (!outcome) {
      if (tableRef) valueEl.textContent = "—";
      return;
    }
    valueEl.textContent = outcome.isTable ? describeTableRow(outcome.row) : String(outcome.total);
  }

  if (tableRef && valueEl) {
    void (async () => {
      const outcome = await resolveTableSilently(dataManager, tableRef);
      valueEl.textContent = outcome ? describeTableRow(outcome.row) : "—";
    })();
  }
  if (interactive) {
    button.setAttribute("data-bs-toggle", "tooltip");
    button.setAttribute("data-bs-title", tableRef ? `Click to reroll on "${tableRef.blockId}"` : `Click to roll ${displayText || expression}`);
    // Clicking anywhere in the button (the value, the expression, or the
    // icon) rolls — one click target, not separate handlers per piece, so
    // there's no dead zone between them.
    button.addEventListener("click", () => void performRoll());
  }
  return button;
}

// Stat-block prose writes dice as either "7 (2d6)" (average, then dice) or a
// bare "2d6+3". The first form keeps its average as the pill's starting
// value instead of a fresh roll, so generated text reads unchanged until
// someone actually clicks.
const PROSE_DICE_PATTERN = /(\d+)\s*\(\s*(\d*d\d+(?:\s*[+-]\s*\d+)?)\s*\)|\b(\d*d\d+(?:\s*[+-]\s*\d+)?)(?![\d\w])/gi;

// Swaps dice notation inside plain text nodes (not authored `dice:` code)
// for the same live pill. Text already inside a pill or a form control is
// left alone.
// `showValue: false` leaves the notation as just the clickable dice string (no pre-rolled number). `rolls` are the
// System's named rolls: a shortName (optionally followed by a +/- number) in the prose becomes a button that rolls
// through that roll, so its tiers and labels apply. A roll's full name counts too, but only with a modifier
// ("Power Roll + Agility"), so prose that merely mentions the roll stays text. `terms` name the character values a
// modifier may be ({text: "Agility", expression: "@stats.abilities.agility"}).
function escapeRegExp(text) {
  return text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function prosePattern(rolls, dice, terms) {
  const dieIds = new Set((Array.isArray(dice) ? dice : []).map((die) => String(die?.id || "").toLowerCase()));
  const rollList = Array.isArray(rolls) ? rolls : [];
  const names = rollList
    .map((roll) => String(roll?.shortName || ""))
    .filter((name) => /^[A-Za-z_]\w*$/.test(name) && !dieIds.has(name.toLowerCase()));
  if (!names.length) return PROSE_DICE_PATTERN;
  const termTexts = (Array.isArray(terms) ? terms : []).map((term) => escapeRegExp(String(term?.text || ""))).filter(Boolean);
  const term = `(?:${termTexts.join("|")})\\b`;
  // "Might or Agility" (and "A, B, or C") is the higher of them.
  const modifier = `\\s*[+-]\\s*(?:\\d+${termTexts.length ? `|${term}(?:,?\\s+(?:or\\s+)?${term})*` : ""})`;
  const fullNames = rollList
    .map((roll) => String(roll?.label || roll?.name || "").trim())
    .filter((name) => name && !names.includes(name))
    .map((name) => escapeRegExp(name).replace(/\s+/g, "\\s+"));
  const named = `\\b(?:(?:${names.join("|")})(?:${modifier})?(?![\\w])${fullNames.length ? `|(?:${fullNames.join("|")})${modifier}` : ""})`;
  return new RegExp(`(\\d+)\\s*\\(\\s*(\\d*d\\d+(?:\\s*[+-]\\s*\\d+)?)\\s*\\)|(${named})|\\b(\\d*d\\d+(?:\\s*[+-]\\s*\\d+)?)(?![\\d\\w])`, "gi");
}

// "Power Roll + Agility" -> "PowerRoll+@stats.abilities.agility", the form rollExpression grades through the roll;
// "Power Roll + Might or Agility" -> "PowerRoll+max(@stats.abilities.might,@stats.abilities.agility)".
function namedRollExpression(text, rolls, terms) {
  let expression = text.replace(/\s+/g, " ").trim();
  (Array.isArray(rolls) ? rolls : []).forEach((roll) => {
    const name = String(roll?.label || roll?.name || "").trim();
    if (name && roll.shortName && expression.toLowerCase().startsWith(name.toLowerCase())) {
      expression = roll.shortName + expression.slice(name.length);
    }
  });
  const usable = (Array.isArray(terms) ? terms : []).filter((term) => term?.text && term.expression);
  if (usable.length) {
    const pattern = new RegExp(`\\b(?:${usable.map((term) => escapeRegExp(term.text)).join("|")})\\b`, "gi");
    const found = [...expression.matchAll(pattern)];
    if (found.length) {
      const expressions = found.map((match) => usable.find((term) => term.text.toLowerCase() === match[0].toLowerCase()).expression);
      const first = found[0].index;
      const last = found[found.length - 1].index + found[found.length - 1][0].length;
      const replacement = expressions.length > 1 ? `max(${expressions.join(",")})` : expressions[0];
      expression = expression.slice(0, first) + replacement + expression.slice(last);
    }
  }
  return expression.replace(/\s+/g, "");
}

export function applyProseDiceRollers(
  container,
  { status, interactive = true, dataManager, label, rolls, dice, terms, context, showValue = true } = {}
) {
  const pattern = prosePattern(rolls, dice, terms);
  if (interactive) preloadDiceOverlay(dataManager);
  const walker = document.createTreeWalker(container, NodeFilter.SHOW_TEXT, {
    acceptNode: (node) =>
      node.parentElement?.closest(".repository-dice-roller, textarea, input, select, button")
        ? NodeFilter.FILTER_REJECT
        : NodeFilter.FILTER_ACCEPT,
  });
  const textNodes = [];
  while (walker.nextNode()) textNodes.push(walker.currentNode);
  textNodes.forEach((node) => {
    const text = node.nodeValue;
    pattern.lastIndex = 0;
    if (!pattern.test(text)) return;
    pattern.lastIndex = 0;
    const fragment = document.createDocumentFragment();
    let cursor = 0;
    let match;
    while ((match = pattern.exec(text)) !== null) {
      fragment.append(text.slice(cursor, match.index));
      const expression = match[3] ? namedRollExpression(match[3], rolls, terms) : (match[2] || match[4]).replace(/\s+/g, "");
      fragment.append(
        buildDiceRoller(expression, {
          status,
          interactive,
          dataManager,
          label,
          initialValue: match[1],
          rolls,
          dice,
          showValue,
          context,
          displayText: match[3] ? match[3].replace(/\s+/g, " ") : "",
        })
      );
      cursor = match.index + match[0].length;
    }
    fragment.append(text.slice(cursor));
    node.replaceWith(fragment);
  });
}

// Runs after marked+DOMPurify — CommonMark's own backtick syntax already
// turned `` `dice:1d4` `` into a plain <code>dice:1d4</code>; this just
// finds those and swaps each one for a live roller, in place.
export function applyDiceRollers(container, { status, interactive = false, dataManager, rolls, dice, label } = {}) {
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
    codeEl.replaceWith(buildDiceRoller(expression, { status, interactive, dataManager, rolls, dice, label }));
  });
}
