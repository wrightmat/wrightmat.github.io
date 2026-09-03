// A Tier-3 symbol die's roll — no numeric total, no keep/drop/success, just
// a multiset of symbols per face. Deliberately NOT inside
// rollDiceExpression/DiceParser: a Genesys-style result is a vector of
// independent symbol counts with cancellation, not a summable number.
// Reachable only from a dedicated stepper UI, never the text-expression
// input — there's no sensible way to type an ad hoc pool as a formula.

// Symbols that cancel 1:1 — success/failure share an axis (did it work),
// advantage/threat share another (complication), per Genesys's real rules.
// Triumph/Despair never cancel — a face carrying one always also carries
// its matching success/failure (see sys.genesys.json's face data).
const CANCEL_PAIRS = [
  ["success", "failure"],
  ["advantage", "threat"],
];

// Shared by rollSymbolDicePool below and dice-overlay.js's physically-rolled
// path (buildSymbolPoolFromDiceBoxValues) — whichever produced the raw
// per-die `symbols` arrays, counting/cancellation work identically.
function aggregateSymbolRolls(rolls) {
  const counts = {};
  rolls.forEach((roll) => {
    roll.symbols.forEach((symbol) => {
      counts[symbol] = (counts[symbol] || 0) + 1;
    });
  });

  const net = { ...counts };
  CANCEL_PAIRS.forEach(([a, b]) => {
    const av = counts[a] || 0;
    const bv = counts[b] || 0;
    net[a] = Math.max(0, av - bv);
    net[b] = Math.max(0, bv - av);
  });

  return { rolls, counts, net };
}

export function rollSymbolDicePool(poolCounts, { random = Math.random, diceById } = {}) {
  const rolls = [];
  (Array.isArray(poolCounts) ? poolCounts : []).forEach(({ dieId, count }) => {
    const die = diceById?.get?.(String(dieId || "").toLowerCase());
    if (!die || !Array.isArray(die.sides) || !die.sides.length) {
      return;
    }
    const rollCount = Math.max(0, Math.floor(Number(count) || 0));
    for (let i = 0; i < rollCount; i += 1) {
      // 0-based face INDEX (unlike dice.js's rollSingleDie, 1-based) since
      // a symbol die's faces have no inherent order/magnitude.
      const faceIndex = Math.floor(random() * die.sides.length);
      const face = die.sides[faceIndex] || { symbols: [] };
      rolls.push({ dieId: die.id, faceIndex, symbols: Array.isArray(face.symbols) ? face.symbols : [] });
    }
  });
  return aggregateSymbolRolls(rolls);
}

// dice-roll.js's physically-rolled counterpart to rollSymbolDicePool.
// `value` is dice-box's already-resolved per-die result for a custom die
// (a string, an array of two strings for a two-symbol face, or "" for
// blank) — the real symbol content already, not a face index, so there's
// no second lookup against this System's own `sides` list (dice-box's
// collider mesh has more physics faces per logical symbol than this
// System's face list does, so the two aren't index-aligned anyway).
export function buildSymbolPoolFromDiceBoxValues(entries) {
  const rolls = (Array.isArray(entries) ? entries : []).map(({ dieId, value }) => ({
    dieId,
    symbols: Array.isArray(value) ? value.filter(Boolean) : value ? [value] : [],
  }));
  return aggregateSymbolRolls(rolls);
}

const SYMBOL_LABELS = {
  success: "Success",
  failure: "Failure",
  advantage: "Advantage",
  threat: "Threat",
  triumph: "Triumph",
  despair: "Despair",
};

// Fixed display order so the result reads consistently regardless of which
// symbols are present; a zero-count symbol is skipped ("0 Success" is noise).
const SYMBOL_ORDER = ["success", "failure", "advantage", "threat", "triumph", "despair"];

export function formatSymbolPoolResult(net) {
  const parts = SYMBOL_ORDER.filter((symbol) => (net?.[symbol] || 0) > 0).map(
    (symbol) => `${net[symbol]} ${SYMBOL_LABELS[symbol]}`
  );
  return parts.length ? parts.join(", ") : "No effect";
}
