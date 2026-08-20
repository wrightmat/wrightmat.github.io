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
// Only for rollSymbolPoolExpression's own optional log-post below — this
// module has no display-formatting knowledge of its own otherwise.
import { formatSymbolPoolResult } from "../../../../workbench/js/lib/symbol-dice.js";
// Rollable Journal tables (`[[Page#^blockId]]`) — recognized/resolved here,
// not `rollDiceExpression` itself, which stays the pure, sync numeric-
// notation engine Forge's own tables.js also depends on. `common/` already
// imports from `repository/` for renderMarkdown (via handout.js), so this
// isn't a new layering direction.
import { parseTableReferenceExpression, resolveTableReference, describeTableRow } from "../../../../repository/js/lib/journal-tables.js";
// The 3D dice overlay — see dice-overlay.js's own header for the full split
// of responsibilities. Only wired into the plain-expression branch below
// (table rolls have nothing to physically roll); every existing caller of
// rollExpression picks this up for free.
import { rollDiceOverlay, rollSymbolDiceOverlay } from "./dice-overlay.js";
// Tier-3 symbol-dice pool engine (Section 1.4/3.4) — rollSymbolPoolExpression
// below is this file's own "try the overlay, else fall back" wrapper around
// it, mirroring rollExpression's own relationship with rollDiceExpression.
import { rollSymbolDicePool, buildSymbolPoolFromDiceBoxValues } from "../../../../workbench/js/lib/symbol-dice.js";

// Expressions eligible for the 3D overlay: a plain +/- sum of `NdM` groups,
// flat numbers, and registered named-die terms (Section 1.1's System.dice,
// e.g. "hopeDie", "2 hopeDie") only — no keep/drop/reroll/explode/success
// comparators, functions, variables, parentheses, or multiplication/
// division. Anything outside that falls back to the ordinary non-visual
// roll below, since dice-box has no way to physically show (say) "4d6, drop
// the lowest" — it only knows how to roll a fixed pile of same/different-
// sided dice. A named-die term can only be recognized against the caller's
// own `dice` list, not a fixed regex, so eligibility is now checked
// term-by-term inside extractSimpleDiceTerms itself rather than a
// standalone whole-string pattern test — returning `null` from it IS "not
// eligible."
//
// Only a die's numeric `sides` is used here — a Tier-3 symbol die (Phase 5,
// an array of face objects instead of a number) has nothing this overlay
// path can roll, so a term naming one safely falls through to "not simple"
// via the `typeof sides === "number"` guard below, same as any other
// ineligible term.
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
      cursor += flatNumberMatch[0].length; // a flat number term — nothing to roll
      continue;
    }
    return null; // anything else (function call, paren, comparator, ...) — not simple
  }
  return terms;
}

// A generous but finite cap — dice-box can physically roll more than this,
// but past a certain pile size the "watch them land" spectacle stops being
// worth the load, so just skip straight to the toast.
const MAX_OVERLAY_DICE = 100;

// Wraps a flat queue of real dice-box values (already in the same
// left-to-right order formula-engine.js's parser will ask for them) as a
// `random()` function, so rollDiceExpression's own keep/drop/success
// handling and detail/HTML formatting run completely untouched — the only
// thing that changed is where the "random" numbers actually came from.
// `(value - 1) / sides` is the exact input rollSingleDie's own
// `Math.floor(random() * sides) + 1` needs to land back on `value`.
function buildScriptedRandom(queue) {
  return () => {
    if (!queue.length) {
      return Math.random(); // never expected — never let an internal bug block a roll
    }
    const { sides, value } = queue.shift();
    return Math.min(0.999999, Math.max(0, (value - 1) / sides));
  };
}

// Returns a rollDiceExpression-shaped result rolled physically via the 3D
// overlay, or `null` if the expression isn't eligible or the overlay isn't
// available right now — either way, the caller just falls back to
// `rollDiceExpression(expression)` as if this never happened.
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
  // A SEPARATE shallow copy, taken BEFORE buildScriptedRandom gets anywhere
  // near `queue` — confirmed real bug this fixes: buildScriptedRandom's own
  // `queue.shift()` (this file, above) MUTATES the exact same array in
  // place as rollDiceExpression below consumes its "random" values one by
  // one, fully draining it to `[]` by the time that call returns. Reading
  // `queue` itself for the broadcast AFTER that call (the first version of
  // this fix) always found it empty, regardless of the actual roll —
  // `dieResultsSnapshot`, captured before any shifting happens, is what
  // actually still holds the real values afterward.
  const dieResultsSnapshot = queue.slice();
  // `dice` must also reach this fallback parse — a named-die term (e.g.
  // "hopeDie") only resolves through the SAME dice map the overlay term
  // extraction above just used; omitting it here would throw "Unexpected
  // token 'hopeDie'" even after a successful physical roll.
  const result = rollDiceExpression(expression, { random: buildScriptedRandom(queue), dice });
  // The REAL physically-rolled per-die values — attached here (only on the
  // overlay path; the plain Math.random fallback below has no "real" dice
  // to speak of) so a Broadcast-mode caller can hand them to a remote
  // viewer's own reveal animation (dice-reveal.js) instead of having that
  // viewer roll independently and hope for a matching result — see this
  // file's own broadcast comment on why dice-box itself can't do that.
  result.dieResults = dieResultsSnapshot;
  return result;
}

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
//
// `context` (optional, default `{}`) is passed straight through to
// rollDiceExpression's own `@path` variable substitution — needed by
// Workbench's ability/save/attack roller buttons, whose formulas reference
// the live character draft (e.g. `1d20 + @abilities.strength.modifier`).
// SIMPLE_EXPRESSION_PATTERN already rejects anything containing `@`, so an
// expression that needs `context` never matches the overlay-eligible path
// and always falls through to the plain rollDiceExpression call below —
// `tryOverlayRoll` itself never needs `context`.
export async function rollExpression(
  expression,
  {
    status,
    label = "",
    dataManager,
    groupContext = null,
    broadcast = false,
    // Whisper-style visibility (see server/groups.py's create_group_log_entry) —
    // a non-empty list logs the roll but restricts who can see it (Private
    // mode passes [currentUserId], a self-whisper). Independent of
    // `broadcast`: a roll can now log-and-be-restricted even when it
    // wouldn't normally broadcast at all (see shouldLog below) — this is
    // what lets the Dice Roller widget's own mode switcher force a Private
    // roll to log even from a button (the plain expression Roll) whose own
    // default behavior has never logged anything.
    recipientIds = undefined,
    dice = [],
    context = {},
  } = {}
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
    const result = (await tryOverlayRoll(trimmed, dataManager, dice)) || rollDiceExpression(trimmed, { dice, context });
    const prefix = label ? `${label}: ` : "";
    status?.show(`${prefix}${trimmed} → ${result.total}`, { type: "success", timeout: 2200 });
    // Logs whenever EITHER broadcast is on OR explicit recipientIds were
    // given — a Private roll has to log (self-only) even from a call site
    // (a plain expression roll) whose own `broadcast` default has never
    // logged anything at all.
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

// Section 2's shared "which System's dice are in effect right now" resolver
// — the active campaign Group's own System (Section 1.2's Group.systemId)
// wins first, then the character's own first Assigned System, else `null`
// (meaning: fall back to the standard 7, Section 4's read-time default).
// Only ever reachable for an authenticated dataManager with a real saved
// System record — D&D (and any System with no `dice` array at all) simply
// returns a payload with no usable `dice`, which resolveQuickDice below
// already treats the same as "no System resolved."
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

// Normalized {id, label, sides} shape of the array above — kept as a
// SEPARATE export rather than changing QUICK_DICE itself, since
// code-block-autocomplete.js's own QUICK_DICE import (Journal text
// suggestions, no System/group context available there) stays on the plain
// string form unchanged.
const STANDARD_DICE = QUICK_DICE.map((id) => ({
  id,
  label: id,
  sides: id === "d100" ? 100 : Number(id.slice(1)),
}));

// A System's own dice (Section 1.1) aren't a new property type or a
// separate top-level array — they're an ordinary Enum-mode Array property
// with the reserved key "dice" (same "just another array field, discovered
// by a fixed marker" shape combat-tracker.js's own Role-marker convention
// already uses, just keyed by the field's own `key` instead of a per-value
// column, since there's only ever one dice vocabulary per System). Each
// value's `name` is the die's id (what expressions reference — e.g.
// "hopeDie") AND its display label, same as every other Enum value in this
// app (Ancestries' "Clank", Rarity's options, ...) — no separate label
// field. `sides`/`color`/`themeOverride`/`faceMap` live in that value's own
// Extra properties (JSON) catch-all, exactly like Modifier's own `die`
// property does today — nothing new for Loom's array editor to support.
export function extractSystemDice(systemDefinition) {
  const fields = Array.isArray(systemDefinition?.fields) ? systemDefinition.fields : [];
  const diceField = fields.find((field) => field?.type === "array" && field.key === "dice");
  const values = Array.isArray(diceField?.values) ? diceField.values : [];
  return (
    values
      .filter((value) => value && typeof value.name === "string" && value.name)
      // A Tier-3 symbol die (Phase 5 — `sides` is an array of face objects,
      // e.g. Genesys's Boost/Setback/Ability/..., not a number) has no
      // numeric face count to roll through this engine at all:
      // rollSingleDie's `Math.floor(Number(sides))` on an array is `NaN`,
      // silently producing garbage rolls rather than throwing. Excluded
      // here — not just from the 3D overlay (extractSimpleDiceTerms already
      // guards that) but from quick-dice buttons and named-die expression
      // resolution entirely — until Phase 5 ships the dedicated symbol-pool
      // stepper UI/roller these dice actually need. A die with `sides: "F"`
      // (Fudge/Fate) is fine and stays included — rollSingleDie already
      // handles that case correctly, just without the 3D overlay.
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

// A System's Tier-3 symbol dice (Phase 5, Section 1.4/3.4) — the SAME
// "dice"-keyed Array field extractSystemDice reads, just the inverse
// filter: entries whose `sides` is a non-empty array of face-symbol
// objects, since a numeric-sided or Fudge die has nothing to do with a
// symbol pool. Consumed only by the dedicated stepper UI (Section 6.3) and
// rollSymbolDicePool/rollSymbolPoolExpression below.
//
// `diceBoxType` (optional, e.g. sys.genesys.json's own boostDie ->
// "boost") is which name this die rolls as in its vendored theme's own
// theme.config.json `diceAvailable` list — the ONLY thing that makes a
// symbol die eligible for the 3D overlay at all (see
// rollSymbolPoolExpression's own tryOverlaySymbolPool). A symbol die with
// no `diceBoxType` (any System without a matching vendored theme yet) just
// always rolls via the plain Math.random pool, same as before this field
// existed.
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

// Same "physically roll it, fall back to the ordinary Math.random pool if
// not eligible or unavailable" contract as tryOverlayRoll above, for a
// Tier-3 symbol-dice pool instead of a numeric expression. Eligibility is
// ALL-or-nothing across the whole requested pool, not per-die — a mix of
// physically-rolled and simulated dice in the same pool would be more
// confusing on screen than just falling back to the plain roll entirely.
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

// `poolCounts`/`diceById` are the exact shapes workbench-character-view.js's
// and dice-roller.js's own symbol-pool steppers already build for
// rollSymbolDicePool — both callers just swap that call for this one.
// Returns the same `{rolls, counts, net}` shape either way (real physics or
// Math.random) — formatSymbolPoolResult (symbol-dice.js) doesn't care which
// path produced it. `.catch(() => null)` mirrors buildScriptedRandom's own
// "never let an internal bug block a roll" philosophy — an overlay-path
// failure here just means this particular roll falls back silently, exactly
// like every other overlay entry point already does.
// `groupContext`/`broadcast`/`recipientIds`/`label`/`notation`/`resultSummary`
// are all optional and only ever used for the SAME log-posting behavior
// rollExpression/rollSystemMove above already have — added so the Dice
// Roller widget's own Default/Broadcast/Private mode switcher works
// identically for a symbol-dice pool roll as it does for a plain numeric
// one (confirmed real requirement: the 3D overlay already covers symbol
// dice too, via rollSymbolDiceOverlay — there's no reason Broadcast
// wouldn't). `resultSummary`/`notation` are pre-formatted by the caller
// `notation` (a human-readable "2 abilityDie + 1 proficiencyDie"-style
// string) is caller-supplied — building it needs each die's own display
// label, which this function only has ids for (diceById is keyed for
// lookup, but the caller already has the same map for its own UI). The
// result SUMMARY, unlike notation, is computed here via
// formatSymbolPoolResult once `rolled` actually exists — it can't be
// pre-formatted by the caller before this function even runs the roll.
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
      .catch(() => {
        // Best-effort — same as rollExpression's own identical broadcast
        // failure handling.
      });
  }
  return rolled;
}

// Section 5's quick-dice source: a resolved System's own dice (Section 1.1)
// when it declares any, else the standard 7 — this is what makes a
// campaign's System (or a character's own) win over the fixed default for
// quick-dice buttons, while a System with no "dice" array field at all
// (every System that hasn't opted in, including D&D) is byte-identical to
// today.
export function resolveQuickDice({ systemDefinition } = {}) {
  const dice = extractSystemDice(systemDefinition);
  return dice.length ? dice : STANDARD_DICE;
}

// A die id doubling as literal NdM dice notation (e.g. "d20") resolves via
// the engine's own reserved bare-`d` grammar — no named-die lookup needed.
// Anything else (e.g. "hopeDie") only resolves through a System's own
// `dice` map (Section 1.1's named-die resolution) and needs `N id` grammar
// instead of `NdM`. Every STANDARD_DICE entry has the numeric-notation
// shape; a System's own named dice generally won't.
function numericNotationSides(id) {
  const match = /^d(\d+)$/i.exec(id || "");
  return match ? match[1] : null;
}

function escapeForRegex(text) {
  return String(text).replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

// How many of each die in `diceList` already appear in `expression` — drives
// each quick button's "× N" active state. `diceList` is whatever
// resolveQuickDice returned for the currently active System — id-keyed so a
// non-numeric-suffix id like "hopeDie" works identically to "d20".
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

// Clicking a quick-dice button either bumps an existing count of that die at
// the start of the expression, bumps the first occurrence anywhere in it, or
// appends a fresh term — whichever applies. `die` is a die's own id, either
// plain numeric notation ("d20") or a System's own named-die id ("hopeDie").
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

// A System's own named Rolls/Moves (Section 1.3) — same convention as dice
// (extractSystemDice above): an ordinary Enum-mode Array property with the
// reserved key "rolls", not a new property type or a dedicated Loom UI.
// Unlike a die's id, a Move is never typed into an expression box, only
// clicked as a button — so its value's `name` can just be a normal,
// human-readable label ("Action Roll", "Duality Roll") with no
// identifier-safety compromise the way a die's shared id/label had to
// accept. `expression`/`resultMode`/`bands`/`compare` live in that value's
// Extra properties (JSON), same home dice's sides/color/faceMap already
// use for one-off per-value metadata.
export function extractSystemRolls(systemDefinition) {
  const fields = Array.isArray(systemDefinition?.fields) ? systemDefinition.fields : [];
  const rollsField = fields.find((field) => field?.type === "array" && field.key === "rolls");
  const values = Array.isArray(rollsField?.values) ? rollsField.values : [];
  return values
    .filter(
      (value) => value && typeof value.name === "string" && value.name && typeof value.expression === "string" && value.expression
    )
    .map((value) => ({
      label: value.name,
      expression: value.expression,
      resultMode: value.resultMode === "compare" ? "compare" : "band",
      bands: Array.isArray(value.bands) ? value.bands : [],
      compare: value.compare && typeof value.compare === "object" ? value.compare : null,
    }));
}

// A tally band (`{ tally: { gte|lte|eq } }`) matches against the tally
// count from a `t`-modifier'd dice group (Section 3.3) — independent of
// which specific dice group produced it, since a Move's expression only
// ever has one meaningful tally in practice (Blades' whole-pool crit rule).
// A range band (`{ min?, max? }`) matches the roll's own total instead. All
// given bounds on whichever kind of band it is must hold — an absent bound
// is unconstrained on that side.
function matchesTallyBand(count, tallySpec) {
  if (typeof count !== "number" || !tallySpec) {
    return false;
  }
  if (typeof tallySpec.gte === "number" && !(count >= tallySpec.gte)) return false;
  if (typeof tallySpec.lte === "number" && !(count <= tallySpec.lte)) return false;
  if (typeof tallySpec.eq === "number" && !(count === tallySpec.eq)) return false;
  return true;
}

function matchesRangeBand(total, band) {
  if (typeof total !== "number") {
    return false;
  }
  if (typeof band.min === "number" && !(total >= band.min)) return false;
  if (typeof band.max === "number" && !(total <= band.max)) return false;
  return true;
}

// Checked in order, first match wins (Section 1.3) — list special/crit
// conditions before the general range bands that would otherwise also
// match the same total. Returns the matched band's label, or `null` if
// nothing matched (a Move's bands don't have to exhaustively cover every
// possible total — an unmatched roll still has a real total, just no named
// verdict for it).
function evaluateBands(bands, result) {
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
    if (matchesRangeBand(result?.total, band)) {
      return band.label || null;
    }
  }
  return null;
}

// Compare mode (Daggerheart's Hope-vs-Fear duality roll) — reads each named
// die's own total out of `result.dice` by matching `compare.a`/`compare.b`
// against each dice-group's own `notation` (a named die's notation is
// literally its own id, e.g. "hopeDie" — see workbench/js/lib/dice.js's
// parseDice), no engine changes needed: rollDiceExpression's existing
// per-group breakdown already carries this. Returns `null` if either named
// die isn't actually present in the roll's own dice breakdown (e.g. the
// Move's `expression` doesn't reference the id `compare.a`/`compare.b`
// name — a Move-authoring mistake, not a runtime error worth crashing on).
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

function evaluateMoveVerdict(move, result) {
  if (move?.resultMode === "compare") {
    const outcome = evaluateCompare(move.compare, result);
    return outcome && outcome.label ? { mode: "compare", label: outcome.label, winner: outcome.winner } : null;
  }
  const label = evaluateBands(move?.bands, result);
  return label ? { mode: "band", label } : null;
}

// Rolls a System-defined Move (Section 1.3/4) — the exact same
// rollExpression every other roll goes through (3D overlay, `@path`
// context substitution, and named dice all just work unmodified), plus
// this Move's own band/compare interpretation layered on top. `label` is
// always overridden to this Move's own label, so the roll's own toast
// reads "Action Roll: 2d6+3 → 8" consistently regardless of what the
// caller passed. A matched verdict fires its own follow-up toast (this
// app's own status root already supports more than one toast on screen —
// see shell.css's own comment on why .status-root centers rather than
// stacks-in-place) rather than trying to rewrite rollExpression's own
// already-shown toast text.
//
// `broadcast`/`groupContext` are handled HERE, not passed through to the
// inner rollExpression call — rollExpression's own broadcast payload has
// no concept of a Move's verdict, and passing both through would double-
// post. A caller with its own richer log-posting already built (Workbench's
// own recordGameLogRoll, which also attaches character context) should
// leave both false/unset here and post the returned result itself, exactly
// like it already does for a plain roll — this built-in broadcast exists
// for a caller with no such helper of its own (the Dashboard Character
// widget). Same payload shape rollExpression's own broadcast already uses,
// plus `verdict`.
//
// Returns rollExpression's own result shape plus `verdict` (`null` if
// nothing matched) — `null`/`isTable` results pass through unchanged,
// since a Move is never a table reference and a failed roll has nothing to
// evaluate.
export async function rollSystemMove(
  move,
  { broadcast = false, recipientIds = undefined, groupContext = null, dataManager, ...rollOptions } = {}
) {
  // recipientIds destructured out here (same as broadcast/groupContext
  // already were) so it never leaks into the inner rollExpression call via
  // ...rollOptions below — that call has its own independent
  // broadcast/recipientIds handling, and passing it through unintentionally
  // would double-post: once from the inner call's own logging, once from
  // this function's own Move-shaped one further down.
  const rolled = await rollExpression(move.expression, { ...rollOptions, dataManager, label: move.label });
  if (!rolled || rolled.isTable) {
    return rolled;
  }
  const verdict = evaluateMoveVerdict(move, rolled.result);
  if (verdict?.label) {
    rollOptions.status?.show(`${move.label}: ${verdict.label}`, { type: "info", timeout: 2600 });
  }
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
          label: move.label || undefined,
          verdict: verdict?.label || undefined,
        },
      })
      .catch(() => {
        // Best-effort — the roll itself already succeeded and was reported
        // locally above; a failed broadcast just means nobody else sees it
        // in the Game Log this time (matches rollExpression's own
        // identical broadcast failure handling).
      });
  }
  return { ...rolled, verdict };
}
