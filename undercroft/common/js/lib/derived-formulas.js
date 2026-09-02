import { evaluateFormula } from "./formula-engine.js";

// The generic replacement for what used to be `dnd-rules.js` — a per-System
// JS module hardcoding D&D's own ability-modifier/proficiency-bonus/HP-
// average math. That's game-rules arithmetic, not something inherent to
// JavaScript, so it belongs on the System record as authored `=formula`
// data (same reserved-key-array convention `dice`/`combatBindings`/
// `levelUpBindings` already use — see undercroft/README.md's "Reserved-key
// System fields") evaluated through the SAME formula engine every other
// `@path`/`=formula` consumer in this suite already shares
// (`formula-engine.js`), not a second bespoke syntax. `findDerivedFormula`/
// `evaluateDerivedFormula` mirror `findBindingByRole` (bindings.js) exactly
// — same shape, same file-not-invented-twice reasoning.
//
// A System with no `derivedFormulas` declared (or missing one specific
// role) gets `undefined` back — graceful degradation, same as every other
// optional System field in this suite, never a crash.
export function findDerivedFormula(formulas, role) {
  return (formulas || []).find((entry) => entry && entry.role === role) || null;
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

// Relocated from dnd-rules.js's own averageDiceRoll — this half is string
// SYNTAX parsing ("2d6+3" -> {count, sides, modifier}), not game-rules
// knowledge, so it stays a small generic JS helper (same category as
// dotted-path.js's path-walking, already listed in README.md as an
// accepted generic utility) rather than becoming System-authored data —
// there's no game rule to author here, just notation. The actual RULE for
// how to turn {count, sides, modifier} into an average damage number is a
// System-declared `derivedFormulas` role (e.g. "averageDamage") evaluated
// via evaluateDerivedFormula above, fed by this parser's own output.
// Convenience composers matching dnd-rules.js's OLD external call shapes
// (same argument order/names, `derivedFormulas` appended as the final
// argument) — every consumer that used to call e.g. `abilityModifier(score)`
// now calls `abilityModifier(score, derivedFormulas)`, minimal call-site
// churn across Crucible/Forge/the Character Builder. Each one is pure
// orchestration over evaluateDerivedFormula/parseDiceExpression above —
// composing two role lookups is not the same thing as hardcoding a
// formula; the actual arithmetic still lives entirely in each System's own
// authored `derivedFormulas` data. A System missing the underlying role(s)
// gets 0/null back, same graceful-degradation posture as everything else
// here.
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
