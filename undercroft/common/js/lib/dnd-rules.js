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
