// A Tier-3 symbol die's roll (Phase 5, Section 1.4/3.4 of the System-Defined
// Dice plan) — no numeric total, no keep/drop/success, just a multiset of
// symbols per face. Deliberately NOT inside rollDiceExpression/DiceParser: a
// Genesys-style result is a vector of independent symbol counts with
// cancellation, not a summable number — there's no meaningful `ast.value`,
// and jamming it into the numeric-AST model would need a fragile synthetic
// numeric encoding for no benefit. Reachable only from a dedicated stepper
// UI (never the text-expression input), since there's no sensible way to
// type "assemble this ad hoc pool" as a formula string.

// Symbols that cancel 1:1 against each other — success/failure narrate the
// same axis (did it work), advantage/threat the same axis (complication),
// per Genesys's real rules. Triumph/Despair never cancel — a face carrying
// one already always carries its matching success/failure too (see
// sys.genesys.json's own face data), so no special-casing is needed here.
const CANCEL_PAIRS = [
  ["success", "failure"],
  ["advantage", "threat"],
];

// `poolCounts`: [{ dieId, count }, ...] — how many of each registered
// symbol die to roll. `diceById`: Map<lowercased id, dieDefinition>, same
// shape extractSystemSymbolDice (dice-roll.js) returns, keyed the same way
// rollDiceExpression's own named-die map already is. `random` defaults to
// Math.random — injectable the same way rollSingleDie's own `random` param
// already is.
// Shared by rollSymbolDicePool (below) and buildSymbolPoolFromDiceBoxValues
// (dice-overlay.js's own physically-rolled path) — whichever produced the
// raw per-die `symbols` arrays, counting and cancellation work identically,
// so there's exactly one place that math lives.
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
      // Same RNG-call shape as workbench/js/lib/dice.js's own rollSingleDie
      // (`Math.floor(random() * sides) + 1` there) — a 0-based face INDEX
      // here rather than a 1-based numeric value, since a symbol die's
      // faces have no inherent order/magnitude to count from 1.
      const faceIndex = Math.floor(random() * die.sides.length);
      const face = die.sides[faceIndex] || { symbols: [] };
      rolls.push({ dieId: die.id, faceIndex, symbols: Array.isArray(face.symbols) ? face.symbols : [] });
    }
  });
  return aggregateSymbolRolls(rolls);
}

// dice-roll.js's own physically-rolled counterpart to rollSymbolDicePool —
// `entries`: [{ dieId, value }, ...], one per individual die actually
// rolled, where `value` is dice-box's own already-resolved per-die result
// for a custom/symbolic die: a string, an array of two strings (a face
// carrying two symbols), or "" for a blank face. Confirmed against
// dice-box's real source (Dice.js) that a custom die's `value` is set
// directly from its theme's colliderFaceMap entry for the landed physics
// face — i.e. the REAL symbol content already, not an index — so there's no
// second lookup against this System's own `sides` face list here at all
// (and there couldn't correctly be one: dice-box's own collider mesh has
// more physics faces per logical symbol than this System's own face list
// does, so the two aren't index-aligned even though they describe the same
// physical die). `faceIndex` (see rollSymbolDicePool's own rolls above) is
// simply absent from these rolls — nothing downstream reads it.
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

// Fixed display order (the headline success/failure axis first, then the
// advantage/threat complication axis, then the rare Triumph/Despair) so the
// formatted result reads consistently regardless of which symbols happen to
// be present. A zero-count symbol is skipped entirely — "0 Success" is just
// noise.
const SYMBOL_ORDER = ["success", "failure", "advantage", "threat", "triumph", "despair"];

export function formatSymbolPoolResult(net) {
  const parts = SYMBOL_ORDER.filter((symbol) => (net?.[symbol] || 0) > 0).map(
    (symbol) => `${net[symbol]} ${SYMBOL_LABELS[symbol]}`
  );
  return parts.length ? parts.join(", ") : "No effect";
}
