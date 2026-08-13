// D&D 5e-specific rules math shared by the tools that generate 5e stat
// blocks (Crucible, Forge) — allowed to be D&D-specific the same way
// mapping-custom-functions.js and system-lookup-tables.js are (see
// undercroft/README.md's Code Conventions section, "DDB-import-specific glue
// is not a hardcoding violation"): this is game-rules math, not a System's
// own vocabulary, so
// it has no data-driven home in a System record the way Rarity/Conditions/
// Activation do.

// Standard D&D 5e ability-modifier formula.
export function abilityModifier(score) {
  return Math.floor((Number(score) - 10) / 2);
}

// Standard 5e rounding (floor) for a dice expression's average — the same
// number every real stat block's own "Hit: N (dice) type damage." leads
// with. Moved here from crucible/js/app.js (which used to define this
// itself) so weapon-attack and save-effect rendering share ONE
// implementation instead of two copies drifting apart. Parses an OPTIONAL
// trailing "+N"/"-N" modifier already embedded in the expression (a literal-
// mode Feature's own stored `damageDice`, e.g. "2d10 + 6", already has a
// monster's ability modifier baked in) — returns null (never a wrong
// number) if the expression doesn't parse, same defensive posture as
// everything else in this pipeline.
export function averageDiceRoll(diceExpression) {
  const raw = String(diceExpression || "").trim();
  const match = raw.match(/(\d+)d(\d+)\s*([+-]\s*\d+)?/i);
  if (match) {
    const count = Number(match[1]);
    const sides = Number(match[2]);
    const modifier = match[3] ? Number(match[3].replace(/\s+/g, "")) : 0;
    return Math.floor((count * (sides + 1)) / 2 + modifier);
  }
  // A bare flat number with no dice notation at all — real, if unusual,
  // stored data: some source text for a tiny creature's attack omits the
  // dice parenthetical entirely when it would average to 1 ("Hit: 1
  // piercing damage.", no "(1d4 - 1)"), and parseWeaponAttack
  // (monster-feature-matching.js) stores that bare number as `damageDice`
  // verbatim rather than inventing dice notation that isn't in the source.
  const flat = raw.match(/^(\d+)$/);
  return flat ? Number(flat[1]) : null;
}

// The three formulas that make a shared Feature (feat.bite, a breath-weapon
// template, ...) usable by a monster whose numbers were never hand-authored
// — computed live from that monster's OWN ability scores and proficiency
// bonus, the way real 5e monster design actually works, instead of a
// literal number baked into a Feature's stored text. `proficiencyBonus` is
// always the monster's own `stats.proficiencyBonus` (crucible/js/lib/
// stats.js — authored per Combat-Scaling-level, same convention as
// attackBonus/saveDC/damagePerRound already use, never derived from a
// numeric CR since CR is only ever stored as a display string).
export function computeAttackBonus(abilityScore, proficiencyBonus) {
  return abilityModifier(abilityScore) + Number(proficiencyBonus || 0);
}

export function computeSaveDC(abilityScore, proficiencyBonus) {
  return 8 + abilityModifier(abilityScore) + Number(proficiencyBonus || 0);
}

// `baseDiceExpression` is a formula-mode Feature's own base die with NO
// ability modifier baked in (e.g. "1d10" — contrast averageDiceRoll's own
// literal-mode input, which already has one embedded) — the modifier is
// added here instead, live, from the monster's own ability score.
export function computeAverageDamage(baseDiceExpression, abilityScore) {
  const base = averageDiceRoll(baseDiceExpression);
  if (base == null) return null;
  return base + abilityModifier(abilityScore);
}
