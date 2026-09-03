// Shared "roll this expression and report the result" wrapper around
// workbench/js/lib/dice.js's rollDiceExpression, plus the quick-dice-button
// logic from Workbench's own dice tool (moved here, imported back so it's
// not duplicated). Used by character-sheet.js's Initiative roller and the
// Dice Roller dashboard widget — one roll-and-report path, one quick-dice
// behavior, not two of each.
import { rollDiceExpression } from "../../../../workbench/js/lib/dice.js";
import { formatSymbolPoolResult } from "../../../../workbench/js/lib/symbol-dice.js";
// Rollable Journal tables (`[[Page#^blockId]]`) are recognized/resolved
// here, not in rollDiceExpression itself, which stays a pure numeric-
// notation engine (Forge's tables.js also depends on that).
import { parseTableReferenceExpression, resolveTableReference, describeTableRow } from "../../../../repository/js/lib/journal-tables.js";
// The 3D dice overlay (see dice-overlay.js) — wired only into the plain-
// expression branch below, since table rolls have nothing to physically roll.
import { rollDiceOverlay, rollSymbolDiceOverlay } from "./dice-overlay.js";
// Tier-3 symbol-dice pool engine — rollSymbolPoolExpression below mirrors
// rollExpression's own "try the overlay, else fall back" shape.
import { rollSymbolDicePool, buildSymbolPoolFromDiceBoxValues } from "../../../../workbench/js/lib/symbol-dice.js";

// Expressions eligible for the 3D overlay: a plain +/- sum of `NdM` groups,
// flat numbers, and registered named-die terms (e.g. "hopeDie") only — no
// keep/drop/reroll/explode/comparators/functions/parens/multiply/divide.
// dice-box can only physically roll a fixed pile of same/different-sided
// dice, not e.g. "drop the lowest", so anything else falls back to the
// ordinary non-visual roll. A named-die term only resolves against the
// caller's own `dice` list, so eligibility is checked term-by-term here
// rather than with a single regex — `null` return means "not eligible".
function extractSimpleDiceTerms(expression, dice = []) {
  const diceById = new Map();
  (Array.isArray(dice) ? dice : []).forEach((die) => {
    if (die && typeof die.id === "string" && die.id) {
      diceById.set(die.id.toLowerCase(), die);
    }
  });
  const terms = [];
  let cursor = 0;
  const length = expression.length;
  while (cursor < length) {
    const signMatch = /^\s*[+-]?\s*/.exec(expression.slice(cursor));
    cursor += signMatch[0].length;
    if (cursor >= length) break;
    const rest = expression.slice(cursor);
    const numericMatch = /^(\d*)d(\d+|%)/i.exec(rest);
    if (numericMatch) {
      const count = numericMatch[1] ? parseInt(numericMatch[1], 10) : 1;
      const sides = numericMatch[2] === "%" ? 100 : parseInt(numericMatch[2], 10);
      if (!Number.isFinite(count) || count <= 0 || !Number.isFinite(sides) || sides <= 0) {
        return null;
      }
      terms.push({ count, sides });
      cursor += numericMatch[0].length;
      continue;
    }
    const namedMatch = /^(\d*)\s*([A-Za-z_][A-Za-z0-9_]*)/.exec(rest);
    if (namedMatch) {
      const namedDie = diceById.get(namedMatch[2].toLowerCase());
      const count = namedMatch[1] ? parseInt(namedMatch[1], 10) : 1;
      if (!namedDie || typeof namedDie.sides !== "number" || namedDie.sides <= 0 || !Number.isFinite(count) || count <= 0) {
        return null;
      }
      terms.push({ count, sides: namedDie.sides, dieId: namedDie.id, color: namedDie.color, themeOverride: namedDie.themeOverride });
      cursor += namedMatch[0].length;
      continue;
    }
    const flatNumberMatch = /^\d+/.exec(rest);
    if (flatNumberMatch) {
      cursor += flatNumberMatch[0].length; // flat number term — nothing to roll
      continue;
    }
    return null; // function call, paren, comparator, etc. — not simple
  }
  return terms;
}

// Above this pile size the 3D overlay's "watch them land" spectacle stops
// being worth the load — dice-box could technically roll more.
const MAX_OVERLAY_DICE = 100;

// Wraps a flat queue of real dice-box values as a `random()` function, so
// rollDiceExpression's own keep/drop/success/formatting logic runs
// untouched — only the source of "randomness" changes. `(value-1)/sides`
// is the exact input rollSingleDie's `Math.floor(random()*sides)+1` needs
// to land back on `value`.
function buildScriptedRandom(queue) {
  return () => {
    if (!queue.length) {
      return Math.random(); // should never happen — never let an internal bug block a roll
    }
    const { sides, value } = queue.shift();
    return Math.min(0.999999, Math.max(0, (value - 1) / sides));
  };
}

// Rolls physically via the 3D overlay, or returns `null` if the expression
// isn't eligible/overlay unavailable — either way the caller falls back to
// a plain rollDiceExpression call as if this never happened.
async function tryOverlayRoll(expression, dataManager, dice = []) {
  const terms = extractSimpleDiceTerms(expression, dice);
  if (!terms || !terms.length) {
    return null;
  }
  if (terms.reduce((sum, term) => sum + term.count, 0) > MAX_OVERLAY_DICE) {
    return null;
  }
  const rolled = await rollDiceOverlay(terms, dataManager);
  if (!rolled) {
    return null;
  }
  const queue = [];
  rolled.forEach(({ sides, values }) => values.forEach((value) => queue.push({ sides, value })));
  // Snapshot BEFORE buildScriptedRandom's own queue.shift() drains it —
  // rollDiceExpression below consumes the same array as its random source.
  const dieResultsSnapshot = queue.slice();
  // `dice` must reach this call too — a named-die term (e.g. "hopeDie")
  // only resolves via the same map extractSimpleDiceTerms just used.
  const result = rollDiceExpression(expression, { random: buildScriptedRandom(queue), dice });
  // The REAL physically-rolled values, attached so a Broadcast-mode caller
  // can hand them to a remote viewer's own reveal animation instead of
  // having that viewer roll independently and hope for a matching result.
  result.dieResults = dieResultsSnapshot;
  return result;
}

// Async (a table reference needs to fetch the referencing Journal page) —
// every caller needs `await`. A plain expression returns
// `{expression, total, result}`; a table reference returns
// `{expression, isTable:true, pageTitle, blockId, roll, dieSize, row,
// headers}` — callers that care check `result.isTable`.
//
// `groupContext`/`broadcast`: when both a truthy `broadcast` and a real
// `groupContext.groupId` are given, a successful plain roll also posts a
// `type:"roll"` group log entry (same shape workbench-character-view.js's
// own recordGameLogRoll posts). Table rolls aren't broadcast this way.
//
// `context` passes through to rollDiceExpression's own `@path` variable
// substitution (Workbench's ability/save/attack rollers reference the live
// character draft, e.g. `1d20 + @abilities.strength.modifier`) — such an
// expression always contains `@`, which is never overlay-eligible, so
// `tryOverlayRoll` itself never needs `context`.
export async function rollExpression(
  expression,
  {
    status,
    // No `= ""` default — an omitted label must stay `undefined` through to
    // rollSystemMove below, whose own `label = move.label` default only
    // applies to a genuinely undefined argument, not an explicit "".
    label,
    dataManager,
    groupContext = null,
    broadcast = false,
    // Whisper-style visibility (server/groups.py's create_group_log_entry):
    // a non-empty list logs the roll but restricts who can see it. Lets the
    // Dice Roller's Private mode force a log even from a plain Roll button,
    // whose own default has never logged anything.
    recipientIds = undefined,
    dice = [],
    context = {},
    // false only from rollSystemMove, which wants ONE combined "roll +
    // verdict" toast instead of this one immediately followed by a second.
    announce = true,
    // System Moves (extractSystemRolls' shape) this roll can resolve
    // against — caller picks the right-scoped list (a character's own
    // System for a field-bound button, campaign-priority activeSystemRolls
    // for the free-typed box/Moves panel; see executeDiceRoll). Empty by
    // default, so a caller with no Moves concept sees no behavior change.
    rolls = [],
    // Threaded to a matched Move's own band grading — see matchesRangeBand.
    targetValue = undefined,
  } = {}
) {
  const trimmed = String(expression || "").trim();
  // A Move reference resolves by shortName, NEVER by comparing expression
  // text (Apocalypse World has two different Moves with the same "2d6+
  // @stats.hard" expression; B/X D&D's Attack Roll and Saving Throw are
  // both bare "d20" — text equality can't tell those apart). This is what
  // lets every caller (a template button, the Dice Roller box, a Moves-
  // panel button) just call rollExpression once and get a Move's bands/
  // compare graded for free when the text resolves to one.
  const move = findRollByShortName(rolls, trimmed);
  if (move) {
    return rollSystemMove(move, {
      status,
      label,
      dataManager,
      groupContext,
      broadcast,
      recipientIds,
      dice,
      context,
      targetValue,
    });
  }
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
      // No "pageTitle (dN)" parenthetical — the table being rolled is
      // already visible wherever this toast was triggered from.
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
    const result = (await tryOverlayRoll(trimmed, dataManager, dice)) || rollDiceExpression(trimmed, { dice, context });
    if (announce) {
      const prefix = label ? `${label}: ` : "";
      status?.show(`${prefix}${trimmed} → ${result.total}`, { type: "success", timeout: 2200 });
    }
    // Logs whenever EITHER broadcast is on OR explicit recipientIds were
    // given — a Private roll has to log (self-only) even from a call site
    // whose own `broadcast` default has never logged anything.
    const hasRecipients = Array.isArray(recipientIds) && recipientIds.length > 0;
    if ((broadcast || hasRecipients) && dataManager && groupContext?.groupId) {
      void dataManager
        .createGroupLogEntry({
          groupId: groupContext.groupId,
          type: "roll",
          message: "",
          recipientIds: hasRecipients ? recipientIds : undefined,
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
          // Best-effort — the roll itself already succeeded locally.
        });
    }
    return { expression: trimmed, total: result.total, result };
  } catch (error) {
    status?.show(error.message || "Unable to roll that.", { type: "danger" });
    return null;
  }
}

// Which System's dice are in effect: the active campaign Group's own
// System wins first, then the character's own first Assigned System, else
// `null` (falls back to the standard 7). A System with no `dice` array at
// all (D&D) returns a payload with no usable dice, same as "no System".
export async function resolveActiveDice({ dataManager, groupContext = null, character = null } = {}) {
  const characterSystemIds = Array.isArray(character?.systemIds)
    ? character.systemIds
    : character?.system
      ? [character.system]
      : [];
  const systemId = groupContext?.systemId || characterSystemIds[0] || "";
  if (!systemId || !dataManager) {
    return null;
  }
  try {
    const result = await dataManager.get("systems", systemId, { preferLocal: false });
    return result?.payload || null;
  } catch (error) {
    return null;
  }
}

export const QUICK_DICE = ["d4", "d6", "d8", "d10", "d12", "d20", "d100"];

// Normalized {id, label, sides} form of QUICK_DICE, kept as a separate
// export since code-block-autocomplete.js's own import needs the plain
// string form unchanged.
const STANDARD_DICE = QUICK_DICE.map((id) => ({
  id,
  label: id,
  sides: id === "d100" ? 100 : Number(id.slice(1)),
}));

// A System's own dice: an ordinary Enum-mode Array property with the
// reserved key "dice", not a new property type. Each value's `name` is
// both the die's id (what expressions reference, e.g. "hopeDie") and its
// display label; `sides`/`color`/`themeOverride`/`faceMap` live in that
// value's own Extra-properties JSON.
export function extractSystemDice(systemDefinition) {
  const fields = Array.isArray(systemDefinition?.fields) ? systemDefinition.fields : [];
  const diceField = fields.find((field) => field?.type === "array" && field.key === "dice");
  const values = Array.isArray(diceField?.values) ? diceField.values : [];
  return (
    values
      .filter((value) => value && typeof value.name === "string" && value.name)
      // A Tier-3 symbol die (`sides` is an array of face objects, not a
      // number — e.g. Genesys's Boost/Setback) has no numeric face count
      // this engine can roll; excluded here (not just from the overlay)
      // until the dedicated symbol-pool stepper UI ships. Fudge dice
      // (`sides: "F"`) are fine and stay included.
      .filter((value) => typeof value.sides === "number" || value.sides === "F")
      .map((value) => ({
        id: value.name,
        label: value.name,
        sides: value.sides,
        color: value.color,
        themeOverride: value.themeOverride,
        faceMap: value.faceMap || null,
      }))
  );
}

// A System's Tier-3 symbol dice — same "dice"-keyed field extractSystemDice
// reads, inverse filter: entries whose `sides` is a face-symbol array.
// `diceBoxType` (e.g. sys.genesys.json's boostDie -> "boost") is the name
// this die rolls as in its vendored theme's diceAvailable list — the only
// thing making a symbol die eligible for the 3D overlay; without it, the
// die always rolls via the plain Math.random pool.
export function extractSystemSymbolDice(systemDefinition) {
  const fields = Array.isArray(systemDefinition?.fields) ? systemDefinition.fields : [];
  const diceField = fields.find((field) => field?.type === "array" && field.key === "dice");
  const values = Array.isArray(diceField?.values) ? diceField.values : [];
  return values
    .filter((value) => value && typeof value.name === "string" && value.name && Array.isArray(value.sides) && value.sides.length)
    .map((value) => ({
      id: value.name,
      label: value.name,
      sides: value.sides,
      color: value.color,
      themeOverride: value.themeOverride,
      diceBoxType: value.diceBoxType || null,
    }));
}

// Same "physically roll it, fall back to Math.random pool if ineligible"
// contract as tryOverlayRoll, for a symbol-dice pool. Eligibility is
// all-or-nothing across the pool — a mix of physical and simulated dice
// on screen would be more confusing than a full fallback.
async function tryOverlaySymbolPool(poolCounts, diceById, dataManager) {
  const entries = (Array.isArray(poolCounts) ? poolCounts : [])
    .map(({ dieId, count }) => ({
      die: diceById?.get?.(String(dieId || "").toLowerCase()),
      count: Math.max(0, Math.floor(Number(count) || 0)),
    }))
    .filter((entry) => entry.count > 0);
  if (!entries.length) {
    return null;
  }
  if (entries.some(({ die }) => !die || typeof die.diceBoxType !== "string" || !die.diceBoxType)) {
    return null;
  }
  const totalCount = entries.reduce((sum, { count }) => sum + count, 0);
  if (totalCount > MAX_OVERLAY_DICE) {
    return null;
  }
  const terms = entries.map(({ die, count }) => ({
    count,
    dieId: die.id,
    dieBoxType: die.diceBoxType,
    color: die.color,
    themeOverride: die.themeOverride,
  }));
  const rolled = await rollSymbolDiceOverlay(terms, dataManager);
  if (!rolled) {
    return null;
  }
  const flatEntries = [];
  rolled.forEach(({ dieId, values }) => values.forEach((value) => flatEntries.push({ dieId, value })));
  return buildSymbolPoolFromDiceBoxValues(flatEntries);
}

// `poolCounts`/`diceById` match the shapes workbench-character-view.js's
// and dice-roller.js's own symbol-pool steppers already build. Returns the
// same `{rolls, counts, net}` shape whether physically rolled or simulated.
// `groupContext`/`broadcast`/`recipientIds`/`label`/`notation` mirror
// rollExpression's own logging so the Dice Roller's mode switcher works
// identically for a symbol pool as for a numeric roll. `notation` is
// caller-supplied (needs each die's own display label); `resultSummary` is
// computed here via formatSymbolPoolResult once the roll actually exists.
export async function rollSymbolPoolExpression(
  poolCounts,
  { diceById, dataManager, groupContext = null, broadcast = false, recipientIds = undefined, label = "", notation = "" } = {}
) {
  const overlayResult = await tryOverlaySymbolPool(poolCounts, diceById, dataManager).catch(() => null);
  const rolled = overlayResult || rollSymbolDicePool(poolCounts, { diceById });
  const hasRecipients = Array.isArray(recipientIds) && recipientIds.length > 0;
  if (rolled && (broadcast || hasRecipients) && dataManager && groupContext?.groupId) {
    void dataManager
      .createGroupLogEntry({
        groupId: groupContext.groupId,
        type: "roll",
        message: "",
        recipientIds: hasRecipients ? recipientIds : undefined,
        payload: {
          label: label || undefined,
          notation: notation || undefined,
          total: formatSymbolPoolResult(rolled.net) || undefined,
        },
      })
      .catch(() => {});
  }
  return rolled;
}

// A resolved System's own dice when it declares any, else the standard 7 —
// a System with no "dice" field (every System that hasn't opted in,
// including D&D) is byte-identical to before this existed.
export function resolveQuickDice({ systemDefinition } = {}) {
  const dice = extractSystemDice(systemDefinition);
  return dice.length ? dice : STANDARD_DICE;
}

// A die id that's also literal NdM notation (e.g. "d20") resolves via the
// engine's own bare-`d` grammar; anything else (e.g. "hopeDie") only
// resolves through a System's own named-die map and needs `N id` grammar.
function numericNotationSides(id) {
  const match = /^d(\d+)$/i.exec(id || "");
  return match ? match[1] : null;
}

function escapeForRegex(text) {
  return String(text).replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

// How many of each die in `diceList` already appear in `expression` —
// drives each quick button's "× N" active state.
export function parseQuickDiceCounts(expression, diceList = STANDARD_DICE) {
  const counts = Object.fromEntries(diceList.map((die) => [die.id, 0]));
  if (typeof expression !== "string" || !expression) {
    return counts;
  }
  diceList.forEach((die) => {
    const sides = numericNotationSides(die.id);
    const pattern = sides
      ? new RegExp(`(?:^|[^A-Za-z0-9_])(\\d*)d${sides}(?!\\d)`, "gi")
      : new RegExp(`(?:^|[^A-Za-z0-9_])(\\d*)\\s*${escapeForRegex(die.id)}(?![A-Za-z0-9_])`, "gi");
    let match;
    let total = 0;
    while ((match = pattern.exec(expression)) !== null) {
      const quantity = match[1] ? parseInt(match[1], 10) : 1;
      if (Number.isFinite(quantity)) {
        total += quantity;
      }
      if (match.index === pattern.lastIndex) {
        pattern.lastIndex += 1; // guard against a zero-width match looping forever
      }
    }
    counts[die.id] = total;
  });
  return counts;
}

// Clicking a quick-dice button bumps an existing count at the start of the
// expression, bumps the first occurrence anywhere in it, or appends a
// fresh term — whichever applies.
export function incrementDieInExpression(die, expression = "") {
  const sides = numericNotationSides(die);
  const escapedId = escapeForRegex(die);
  const buildTerm = (count) => (sides ? `${count}d${sides}` : `${count} ${die}`);

  const patternStart = sides
    ? new RegExp(`^(\\s*)(\\d*)d${sides}(?!\\d)`, "i")
    : new RegExp(`^(\\s*)(\\d*)\\s*${escapedId}(?![A-Za-z0-9_])`, "i");
  if (patternStart.test(expression)) {
    return expression.replace(patternStart, (match, leading, count) => {
      const base = parseInt(count || "1", 10);
      const next = Number.isFinite(base) ? base + 1 : 2;
      return `${leading}${buildTerm(next)}`;
    });
  }
  const pattern = sides
    ? new RegExp(`([^A-Za-z0-9_])(\\d*)d${sides}(?!\\d)`, "i")
    : new RegExp(`([^A-Za-z0-9_])(\\d*)\\s*${escapedId}(?![A-Za-z0-9_])`, "i");
  let replaced = false;
  const updated = expression.replace(pattern, (match, prefix, count) => {
    if (replaced) {
      return match;
    }
    const base = parseInt(count || "1", 10);
    const next = Number.isFinite(base) ? base + 1 : 2;
    replaced = true;
    return `${prefix}${buildTerm(next)}`;
  });
  if (replaced) {
    return updated;
  }
  const trimmed = expression.trim();
  if (!trimmed) {
    return buildTerm(1);
  }
  if (/[+\-*/(]$/.test(trimmed)) {
    return `${expression} ${buildTerm(1)}`;
  }
  return `${trimmed} + ${buildTerm(1)}`;
}

// A System's own named Rolls/Moves — same convention as dice: an ordinary
// Enum-mode Array property with the reserved key "rolls". A Move is
// IDENTIFIED by its `shortName` (Loom's standard short-token column, same
// field characteristics/traits use for "STR"/"AGI") — never by
// `expression`. Two real Systems prove why: Apocalypse World has two
// different Moves with the identical "2d6+@stats.hard" expression; B/X
// D&D's Attack Roll and Saving Throw are both bare "d20" — expression
// equality can't tell those apart. `name` is the free-text display label;
// `shortName` is what a caller looks the Move up by. `expression`/
// `resultMode`/`bands`/`compare` live in the value's own Extra-properties
// JSON, same as dice's sides/color/faceMap.
export function extractSystemRolls(systemDefinition) {
  const fields = Array.isArray(systemDefinition?.fields) ? systemDefinition.fields : [];
  const rollsField = fields.find((field) => field?.type === "array" && field.key === "rolls");
  const values = Array.isArray(rollsField?.values) ? rollsField.values : [];
  return values
    .filter(
      (value) =>
        value &&
        typeof value.name === "string" &&
        value.name &&
        typeof value.shortName === "string" &&
        value.shortName &&
        typeof value.expression === "string" &&
        value.expression
    )
    .map((value) => ({
      label: value.name,
      shortName: value.shortName,
      expression: value.expression,
      resultMode: value.resultMode === "compare" ? "compare" : "band",
      bands: Array.isArray(value.bands) ? value.bands : [],
      compare: value.compare && typeof value.compare === "object" ? value.compare : null,
    }));
}

// Case-insensitive, exact-token match — a shortName is a typed reference
// (like a named die's id), not a search/substring match.
export function findRollByShortName(rolls, shortName) {
  const needle = typeof shortName === "string" ? shortName.trim().toLowerCase() : "";
  if (!needle || !Array.isArray(rolls)) {
    return null;
  }
  return rolls.find((entry) => typeof entry.shortName === "string" && entry.shortName.toLowerCase() === needle) || null;
}

// A tally band (`{tally:{gte|lte|eq}}`) matches a `t`-modifier'd dice
// group's tally count. A range band (`{min?, max?}`) matches the roll's
// total. All given bounds on a band must hold; an absent bound is
// unconstrained on that side.
function matchesTallyBand(count, tallySpec) {
  if (typeof count !== "number" || !tallySpec) {
    return false;
  }
  if (typeof tallySpec.gte === "number" && !(count >= tallySpec.gte)) return false;
  if (typeof tallySpec.lte === "number" && !(count <= tallySpec.lte)) return false;
  if (typeof tallySpec.eq === "number" && !(count === tallySpec.eq)) return false;
  return true;
}

// `target*` keys let a band compare the roll against a value the caller
// resolved at roll time (e.g. a character's own skill score) instead of a
// fixed number baked into the Move — this is what makes a percentile
// roll-under System (CoC's d100, Regular/Hard/Extreme as fractions of
// whatever's being tested) representable at all. A band mixing `min`/`max`
// with `target*` keys requires BOTH to hold (fixed-total conditions gate
// special cases like a natural 1/100 regardless of target).
// - `targetBelow`/`targetAtLeast`: a condition on the target itself (CoC's
//   "96-99 is a Fumble only if the skill is under 50").
// - `targetMaxFraction`/`targetMinFraction`: the roll bounded by a fraction
//   of the target, rounded down (CoC's Hard success = roll <= half skill).
// - `targetExceeds`: the roll must be STRICTLY GREATER than the raw target
//   (a "roll over" check — CoC's optional Luck-regain rule).
// A band using any `target*` key simply doesn't match when no targetValue
// was passed (a context-free roll) — same as an unmatched band otherwise.
function matchesRangeBand(total, band, targetValue) {
  if (typeof total !== "number") {
    return false;
  }
  if (typeof band.min === "number" && !(total >= band.min)) return false;
  if (typeof band.max === "number" && !(total <= band.max)) return false;
  const usesTarget =
    typeof band.targetBelow === "number" ||
    typeof band.targetAtLeast === "number" ||
    typeof band.targetMaxFraction === "number" ||
    typeof band.targetMinFraction === "number" ||
    band.targetExceeds === true;
  if (usesTarget) {
    if (typeof targetValue !== "number") return false;
    if (typeof band.targetBelow === "number" && !(targetValue < band.targetBelow)) return false;
    if (typeof band.targetAtLeast === "number" && !(targetValue >= band.targetAtLeast)) return false;
    if (typeof band.targetMaxFraction === "number" && !(total <= Math.floor(targetValue * band.targetMaxFraction))) {
      return false;
    }
    if (typeof band.targetMinFraction === "number" && !(total >= Math.floor(targetValue * band.targetMinFraction))) {
      return false;
    }
    if (band.targetExceeds === true && !(total > targetValue)) return false;
  }
  return true;
}

// First match wins — list special/crit conditions before general range
// bands that would otherwise also match. Returns `null` if nothing matched
// (bands don't have to exhaustively cover every total).
function evaluateBands(bands, result, targetValue) {
  if (!Array.isArray(bands) || !bands.length) {
    return null;
  }
  const diceDetails = Array.isArray(result?.dice) ? result.dice : [];
  const firstTally = diceDetails.find((detail) => detail?.tally)?.tally || null;
  for (const band of bands) {
    if (band?.tally) {
      if (firstTally && matchesTallyBand(firstTally.count, band.tally)) {
        return band.label || null;
      }
      continue;
    }
    if (matchesRangeBand(result?.total, band, targetValue)) {
      return band.label || null;
    }
  }
  return null;
}

// Compare mode (Daggerheart's Hope-vs-Fear duality roll): reads each named
// die's total from `result.dice` by matching `compare.a`/`compare.b`
// against each dice-group's own notation (a named die's notation is its
// own id, e.g. "hopeDie"). Returns `null` if either named die isn't
// actually present in the roll (a Move-authoring mistake, not a crash).
function evaluateCompare(compareSpec, result) {
  if (!compareSpec || !compareSpec.a || !compareSpec.b) {
    return null;
  }
  const diceDetails = Array.isArray(result?.dice) ? result.dice : [];
  const a = diceDetails.find((detail) => detail?.notation === compareSpec.a);
  const b = diceDetails.find((detail) => detail?.notation === compareSpec.b);
  if (!a || !b || typeof a.total !== "number" || typeof b.total !== "number") {
    return null;
  }
  if (a.total > b.total) return { winner: "a", label: compareSpec.aLabel || "" };
  if (b.total > a.total) return { winner: "b", label: compareSpec.bLabel || "" };
  return { winner: "tie", label: compareSpec.tieLabel || "" };
}

function evaluateMoveVerdict(move, result, targetValue) {
  if (move?.resultMode === "compare") {
    const outcome = evaluateCompare(move.compare, result);
    return outcome && outcome.label ? { mode: "compare", label: outcome.label, winner: outcome.winner } : null;
  }
  const label = evaluateBands(move?.bands, result, targetValue);
  return label ? { mode: "band", label } : null;
}

// Rolls a System-defined Move through the same rollExpression every other
// roll uses (3D overlay, `@path` substitution, named dice all just work),
// plus this Move's own band/compare interpretation. `targetValue` is a
// number the caller already resolved from the character sheet — left unset
// from a context-free caller (the standalone Dice Roller has no field to
// read), in which case any band relying on it simply won't match. `label`
// defaults to the Move's own name but a caller rolling FOR a specific
// field overrides it, so toasts read "Dexterity: 45" / "Dexterity:
// Regular Success" rather than repeating the Move's generic name.
//
// `broadcast`/`groupContext` are handled HERE rather than passed into the
// inner rollExpression call, which has no concept of a verdict and would
// double-post. A caller with its own richer log-posting (Workbench's
// recordGameLogRoll) should leave both unset and post the result itself.
export async function rollSystemMove(
  move,
  {
    broadcast = false,
    recipientIds = undefined,
    groupContext = null,
    dataManager,
    targetValue = undefined,
    label = move.label,
    ...rollOptions
  } = {}
) {
  // recipientIds/targetValue destructured out so neither leaks into the
  // inner call via ...rollOptions — passing recipientIds through would
  // double-post (once from the inner call's own logging, once here).
  // announce:false skips that inner call's own toast, since the combined
  // "roll + verdict" toast below is the only one that should show.
  const rolled = await rollExpression(move.expression, { ...rollOptions, dataManager, label, announce: false });
  if (!rolled || rolled.isTable) {
    return rolled;
  }
  const verdict = evaluateMoveVerdict(move, rolled.result, targetValue);
  const prefix = label ? `${label}: ` : "";
  const verdictSuffix = verdict?.label ? ` — ${verdict.label}` : "";
  // The RESOLVED notation (e.g. "2d6 kh1 t>=6"), not move.expression's own
  // unsubstituted form — the toast should read what was actually rolled.
  const notation = rolled.result?.notation || move.expression;
  rollOptions.status?.show(`${prefix}${notation} → ${rolled.total}${verdictSuffix}`, {
    type: "success",
    timeout: 2600,
  });
  const hasRecipients = Array.isArray(recipientIds) && recipientIds.length > 0;
  if ((broadcast || hasRecipients) && dataManager && groupContext?.groupId) {
    void dataManager
      .createGroupLogEntry({
        groupId: groupContext.groupId,
        type: "roll",
        message: "",
        recipientIds: hasRecipients ? recipientIds : undefined,
        payload: {
          expression: move.expression,
          notation: rolled.result?.notation || move.expression,
          total: rolled.total,
          detailHtml: rolled.result?.detailHtml || undefined,
          detailText: rolled.result?.detailText || undefined,
          dice: Array.isArray(rolled.result?.dice) && rolled.result.dice.length ? rolled.result.dice : undefined,
          label: label || undefined,
          verdict: verdict?.label || undefined,
          target: typeof targetValue === "number" ? targetValue : undefined,
        },
      })
      .catch(() => {
        // Best-effort — the roll already succeeded and was reported above.
      });
  }
  return { ...rolled, verdict };
}
