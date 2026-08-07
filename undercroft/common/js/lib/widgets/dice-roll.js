// Thin, shared "roll this expression and report the result" wrapper around
// Workbench's own dice engine (workbench/js/lib/dice.js's rollDiceExpression,
// reused as-is — see map.js's identical reasoning for reusing Orrery's
// renderMapLayers), plus the exact quick-dice-button expression-building
// logic from Workbench's own dice tool (workbench-character-view.js's
// QUICK_DICE/incrementDieInExpression/parseQuickDiceCounts, moved here
// verbatim and imported back by that file, not duplicated). Used by
// character-sheet.js's Initiative roller and the standalone Dice Roller
// dashboard widget, so there's one roll-and-report path and one quick-dice-
// button behavior, not two of each.
import { rollDiceExpression } from "../../../../workbench/js/lib/dice.js";
// Rollable Journal tables (`[[Page#^blockId]]`) — recognized/resolved here,
// not `rollDiceExpression` itself, which stays the pure, sync numeric-
// notation engine Forge's own tables.js also depends on. `common/` already
// imports from `repository/` for renderMarkdown (via handout.js), so this
// isn't a new layering direction.
import { parseTableReferenceExpression, resolveTableReference, describeTableRow } from "../../../../repository/js/lib/journal-tables.js";

// Async now (a table reference needs to fetch the referencing Journal page)
// — every existing caller needs `await`. Returns `null` if the expression
// was invalid or unresolvable (already toasted). A plain numeric expression
// returns `{expression, total, result}` (`result` is rollDiceExpression's
// own full return value) exactly as before; a table reference returns
// `{expression, isTable:true, pageTitle, blockId, roll, dieSize, row,
// headers}` instead — callers that care about the difference check
// `result.isTable`, everyone else can just read `.expression` back.
//
// `groupContext`/`broadcast` are optional and default to no behavior change
// for every existing caller (character-sheet.js's Initiative roller, the
// Dice Roller dashboard widget) — when both a truthy `broadcast` and a real
// `groupContext.groupId` are given, a successful plain-expression roll also
// posts a `type:"roll"` group log entry, same shape
// workbench-character-view.js's own recordGameLogRoll already posts, so it
// renders identically in the Game Log/second-screen wherever roll entries
// are already handled. Table rolls aren't broadcast this way yet — not
// needed for the Dice Roller macro action this was added for.
export async function rollExpression(
  expression,
  { status, label = "", dataManager, groupContext = null, broadcast = false } = {}
) {
  const trimmed = String(expression || "").trim();
  const tableRef = parseTableReferenceExpression(trimmed);
  if (tableRef) {
    if (!dataManager) {
      status?.show("Table rolls aren't available here.", { type: "danger" });
      return null;
    }
    try {
      const outcome = await resolveTableReference(dataManager, tableRef);
      if (!outcome) {
        status?.show(`Couldn't find "${tableRef.title}#^${tableRef.blockId}".`, { type: "danger" });
        return null;
      }
      // Just the number/result — no "pageTitle (dN)" parenthetical, same
      // reasoning journal-dice.js's own chip and the Dice Roller widget's
      // result line drop it: the table that was rolled is already visible
      // wherever this toast was triggered from (a chip's own tooltip, or
      // the widget's own input), so repeating it here is just noise.
      const prefix = label ? `${label}: ` : "";
      status?.show(`${prefix}${describeTableRow(outcome.row)}`, {
        type: "success",
        timeout: 2600,
      });
      return { expression: trimmed, isTable: true, ...outcome };
    } catch (error) {
      status?.show(error?.message || "Unable to roll that table.", { type: "danger" });
      return null;
    }
  }
  try {
    const result = rollDiceExpression(trimmed);
    const prefix = label ? `${label}: ` : "";
    status?.show(`${prefix}${trimmed} → ${result.total}`, { type: "success", timeout: 2200 });
    if (broadcast && dataManager && groupContext?.groupId) {
      void dataManager
        .createGroupLogEntry({
          groupId: groupContext.groupId,
          type: "roll",
          message: "",
          payload: {
            expression: trimmed,
            notation: result.notation || trimmed,
            total: result.total,
            detailHtml: result.detailHtml || undefined,
            detailText: result.detailText || undefined,
            dice: Array.isArray(result.dice) && result.dice.length ? result.dice : undefined,
            label: label || undefined,
          },
        })
        .catch(() => {
          // Best-effort — the roll itself already succeeded and was
          // reported locally above; a failed broadcast just means nobody
          // else sees it in the Game Log this time.
        });
    }
    return { expression: trimmed, total: result.total, result };
  } catch (error) {
    status?.show(error.message || "Unable to roll that.", { type: "danger" });
    return null;
  }
}

export const QUICK_DICE = ["d4", "d6", "d8", "d10", "d12", "d20", "d100"];

// How many of each QUICK_DICE die already appear in `expression` — drives
// each quick button's "× N" active state.
export function parseQuickDiceCounts(expression) {
  const counts = Object.fromEntries(QUICK_DICE.map((die) => [die, 0]));
  if (typeof expression !== "string" || !expression) {
    return counts;
  }
  const regex = /(\d*)d(4|6|8|10|12|20|100)(?!\d)/gi;
  let match;
  while ((match = regex.exec(expression)) !== null) {
    const quantity = match[1] ? parseInt(match[1], 10) : 1;
    const die = `d${match[2]}`.toLowerCase();
    if (Number.isFinite(quantity) && counts[die] !== undefined) {
      counts[die] += quantity;
    }
  }
  return counts;
}

// Clicking a quick-dice button (e.g. "d6") either bumps an existing count of
// that die at the start of the expression, bumps the first occurrence
// anywhere in it, or appends a fresh `1d<sides>` term — whichever applies.
export function incrementDieInExpression(die, expression = "") {
  const sides = die.slice(1);
  const patternStart = new RegExp(`^(\\s*)(\\d*)d${sides}(?!\\d)`, "i");
  if (patternStart.test(expression)) {
    return expression.replace(patternStart, (match, leading, count) => {
      const base = parseInt(count || "1", 10);
      const next = Number.isFinite(base) ? base + 1 : 2;
      return `${leading}${next}d${sides}`;
    });
  }
  const pattern = new RegExp(`([^A-Za-z0-9_])(\\d*)d${sides}(?!\\d)`, "i");
  let replaced = false;
  const updated = expression.replace(pattern, (match, prefix, count) => {
    if (replaced) {
      return match;
    }
    const base = parseInt(count || "1", 10);
    const next = Number.isFinite(base) ? base + 1 : 2;
    replaced = true;
    return `${prefix}${next}d${sides}`;
  });
  if (replaced) {
    return updated;
  }
  const trimmed = expression.trim();
  if (!trimmed) {
    return `1d${sides}`;
  }
  if (/[+\-*/(]$/.test(trimmed)) {
    return `${expression} 1d${sides}`;
  }
  return `${trimmed} + 1d${sides}`;
}
