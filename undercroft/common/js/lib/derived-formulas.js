import { evaluateFormula } from "./formula-engine.js";

// Game-rules arithmetic (ability modifiers, proficiency bonus, HP average)
// lives on the System record as authored `=formula` data (the reserved-key-
// array convention `dice`/`combatBindings`/`levelUpBindings` already use),
// evaluated through the same formula engine every other `@path`/`=formula`
// consumer shares. `findDerivedFormula`/`evaluateDerivedFormula` mirror
// `findBindingByRole` (bindings.js) exactly.
//
// A System with no `derivedFormulas` declared (or missing one role) gets
// `undefined` back — graceful degradation, never a crash.
export function findDerivedFormula(formulas, role) {
  return (formulas || []).find((entry) => entry && entry.binding === role) || null;
}

export function evaluateDerivedFormula(formulas, role, context) {
  const entry = findDerivedFormula(formulas, role);
  if (!entry || typeof entry.formula !== "string" || !entry.formula.trim()) {
    return undefined;
  }
  try {
    const result = evaluateFormula(entry.formula, context || {}, {});
    return result === null ? undefined : result;
  } catch (error) {
    console.warn(`derived-formulas: unable to evaluate "${role}"`, error);
    return undefined;
  }
}

// String SYNTAX parsing ("2d6+3" -> {count, sides, modifier}), not game-
// rules knowledge, so it stays a small generic JS helper rather than
// System-authored data — there's no rule to author here, just notation.
// The actual rule for turning that shape into an average damage number is
// a System-declared `derivedFormulas` role, evaluated via
// evaluateDerivedFormula above, fed by this parser's output.
//
// Convenience composers below are pure orchestration over
// evaluateDerivedFormula/parseDiceExpression — the actual arithmetic still
// lives entirely in each System's own authored `derivedFormulas` data. A
// System missing the underlying role(s) gets 0/null back.
export function abilityModifier(score, derivedFormulas) {
  return evaluateDerivedFormula(derivedFormulas, "abilityModifier", { score }) || 0;
}

export function hitPointsPerLevelAverage(hitDieSides, derivedFormulas) {
  return evaluateDerivedFormula(derivedFormulas, "hitPointsPerLevelAverage", { sides: hitDieSides }) || 0;
}

export function proficiencyBonusForLevel(totalLevel, derivedFormulas) {
  return evaluateDerivedFormula(derivedFormulas, "proficiencyBonusForLevel", { level: totalLevel }) || 0;
}

export function averageDiceRoll(diceExpression, derivedFormulas) {
  const parsed = parseDiceExpression(diceExpression);
  if (!parsed) return null;
  const result = evaluateDerivedFormula(derivedFormulas, "diceAverage", parsed);
  return result == null ? null : result;
}

export function computeAttackBonus(abilityScore, proficiencyBonus, derivedFormulas) {
  const modifier = abilityModifier(abilityScore, derivedFormulas);
  return evaluateDerivedFormula(derivedFormulas, "attackBonus", { abilityModifier: modifier, proficiencyBonus: Number(proficiencyBonus) || 0 }) || 0;
}

export function computeSaveDC(abilityScore, proficiencyBonus, derivedFormulas) {
  const modifier = abilityModifier(abilityScore, derivedFormulas);
  return evaluateDerivedFormula(derivedFormulas, "saveDC", { abilityModifier: modifier, proficiencyBonus: Number(proficiencyBonus) || 0 }) || 0;
}

export function computeAverageDamage(baseDiceExpression, abilityScore, derivedFormulas) {
  const parsed = parseDiceExpression(baseDiceExpression);
  if (!parsed) return null;
  const modifier = abilityModifier(abilityScore, derivedFormulas);
  const result = evaluateDerivedFormula(derivedFormulas, "averageDamage", { ...parsed, abilityModifier: modifier });
  return result == null ? null : result;
}

export function parseDiceExpression(diceExpression) {
  const raw = String(diceExpression || "").trim();
  const match = raw.match(/(\d+)d(\d+)\s*([+-]\s*\d+)?/i);
  if (match) {
    return {
      count: Number(match[1]),
      sides: Number(match[2]),
      modifier: match[3] ? Number(match[3].replace(/\s+/g, "")) : 0,
    };
  }
  const flat = raw.match(/^(\d+)$/);
  if (flat) {
    return { count: 0, sides: 0, modifier: Number(flat[1]) };
  }
  return null;
}
