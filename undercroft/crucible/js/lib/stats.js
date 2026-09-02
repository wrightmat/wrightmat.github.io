// Derives a starting combat stat block for a generated monster from what's
// already been selected (a resolved combatScaling level, the Role, the
// Creature Type, and the chosen features) — a reasonable jumping-off point
// for a GM to hand-tune, not a rigorous combat simulator. Mirrors Vault's
// budget mechanic (js/lib/generator.js#computeBudget) for the feature-spend
// side of things, and pulls scaling targets from the active System's
// combatScaling field (tables.js#loadCombatScalingLevels) exactly the way
// Vault pulls Rarity/Activation/Form from its own generator-property fields.
import { loadCombatScalingLevels, loadDamageTypesPropertyType } from "./tables.js";
import { abilityModifier } from "../../../common/js/lib/derived-formulas.js";
import { setAtBinding, findBindingByRole, findBindingsByRole } from "../../../common/js/lib/bindings.js";

function pickRandom(list, random) {
  if (!list.length) return null;
  return list[Math.floor(random() * list.length)];
}

// Role's mechanicalTendencies bands are a small, fixed, already-authored
// vocabulary (see every saved role/*.json) meant for a human GM to read —
// translated here into rough multipliers/bonuses scoped to this file only,
// not promoted to a System field or a Role schema change.
const HP_BAND_MULTIPLIER = { low: 0.7, "low-moderate": 0.85, moderate: 1, high: 1.2, "very-high": 1.5 };
const AC_BAND_MULTIPLIER = { low: 0.85, "low-moderate": 0.92, moderate: 1, high: 1.1, "very-high": 1.15 };
const CON_BAND_BONUS = { low: -2, "low-moderate": -1, moderate: 0, high: 2, "very-high": 4 };
const DAMAGE_PROFILE_MULTIPLIER = {
  minimal: 0.5,
  "low-direct": 0.75,
  sustained: 1,
  burst: 1.15,
  "burst-from-stealth": 1.25,
  "heavy-melee": 1.1,
  "high-ranged": 1.1,
  "multi-target": 1,
};
const RANGED_DAMAGE_PROFILES = new Set(["high-ranged"]);
const MULTIATTACK_ACTION_ECONOMIES = new Set(["multiple-actions-per-round"]);

function clamp(value, min, max) {
  return Math.max(min, Math.min(max, value));
}

// Nearest NdX+B combo (using d6 as the base die) matching a target average —
// close enough for a starting block; exact die choice is left to the GM.
function diceExpressionForAverage(average) {
  const target = Math.max(0, Math.round(average));
  if (target === 0) return "0";
  const count = Math.max(1, Math.round(target / 3.5));
  const bonus = target - Math.round(count * 3.5);
  return bonus === 0 ? `${count}d6` : `${count}d6${bonus > 0 ? "+" : ""}${bonus}`;
}

function resolveCombatScalingLevel(levels, combatScalingId, random) {
  if (!levels.length) return null;
  return (combatScalingId && levels.find((level) => level.id === combatScalingId)) || pickRandom(levels, random);
}

// `abilityFieldDefs` (loadAbilityFieldDefs in tables.js) supplies the SET of
// ability keys to populate — read from the active System's own "abilities"
// field rather than a hardcoded six-key copy. Which key is "primary" for a
// melee/ranged build and which one benefits from the HP-band Constitution
// bonus is still D&D-specific rules logic (same class of thing as
// derived-formulas.js's abilityModifier — there's no data-driven home for "which
// ability is Constitution" on a System record — the FORMULA is data-driven
// via derivedFormulas, just not which ability key feeds it), so those two boosts are only
// applied if the resulting key set actually contains "strength"/"dexterity"/
// "constitution" — a System without one of those simply doesn't get that
// particular boost, rather than erroring.
function deriveAbilities(role, abilityFieldDefs) {
  const tendencies = role?.mechanicalTendencies || {};
  const damageProfile = tendencies.damageProfile || "";
  const isRanged = RANGED_DAMAGE_PROFILES.has(damageProfile);
  const primaryKey = isRanged ? "dexterity" : "strength";
  const abilities = {};
  abilityFieldDefs.forEach((def) => {
    abilities[def.key] = 10;
  });
  const primaryBoost = DAMAGE_PROFILE_MULTIPLIER[damageProfile] ? Math.round((DAMAGE_PROFILE_MULTIPLIER[damageProfile] - 1) * 8) : 0;
  if (primaryKey in abilities) {
    abilities[primaryKey] = clamp(14 + primaryBoost, 8, 20);
  }
  if ("constitution" in abilities) {
    abilities.constitution = clamp(12 + (CON_BAND_BONUS[tendencies.hpBand] ?? 0), 8, 20);
  }
  return abilities;
}

// One action entry per combat-tagged feature, each getting its
// damageWeight-proportional share of the target damagePerRound. A build with
// no combat-tagged features still gets a single generic Attack so the
// derived damagePerRound isn't silently dropped.
function buildActions(features, damagePerRound, attackBonus, damageTypeList) {
  const combatFeatures = features.filter((feature) => feature.combat && typeof feature.combat.damageWeight === "number");
  // A generic melee/natural attack defaults to Bludgeoning regardless of
  // where that happens to sort in the System's damageTypes list (list order
  // is authoring order, not a preference ranking) — only used when nothing
  // selected specifies its own damageType.
  const knownTypes = new Set(damageTypeList.map((entry) => entry.label));
  const fallbackDamageType = knownTypes.has("Bludgeoning") ? "Bludgeoning" : damageTypeList[0]?.label || "Bludgeoning";

  if (!combatFeatures.length) {
    return [
      {
        name: "Attack",
        damageType: fallbackDamageType,
        damageDice: diceExpressionForAverage(damagePerRound),
        attackBonus,
      },
    ];
  }

  const totalWeight = combatFeatures.reduce((sum, feature) => sum + Number(feature.combat.damageWeight || 0), 0) || 1;
  return combatFeatures.map((feature) => {
    const share = damagePerRound * (Number(feature.combat.damageWeight || 0) / totalWeight);
    return {
      name: feature.name,
      damageType: feature.combat.damageType || fallbackDamageType,
      damageDice: diceExpressionForAverage(share),
      attackBonus,
      actionCost: feature.combat.actionCost || "action",
    };
  });
}

/**
 * deriveStats({ systemId, combatScalingField, combatScalingId, role, creatureType, features, dataManager, random })
 *
 * `role`/`creatureType` are the already-resolved records (same ones
 * generateMonster resolved), `features` the already-resolved selected
 * feature records. Every input degrades gracefully: a System with no
 * combatScaling/damageTypes data still produces a bare-minimum stat block
 * instead of an error.
 *
 * `combatScalingField` (optional) is the GM's own configured Combat Scaling
 * field preference (crucible/js/app.js's own getCombatScalingFieldPreference)
 * — previously never threaded through here at all, so this function always
 * silently fell back to loadCombatScalingLevels' own hardcoded
 * "combatScaling" default regardless of what the GM had actually configured
 * in Settings. Harmless while every System's own field really was called
 * "combatScaling"; a real, visible bug (Challenge always showing unset) the
 * moment sys.dnd5e.json's own field got its real name, "challengeRating" —
 * reloadReferenceData's own call already passed this correctly, this one
 * didn't.
 */
export async function deriveStats({
  systemId,
  combatScalingField = "",
  combatScalingId = "",
  role = null,
  creatureType = null,
  features = [],
  dataManager,
  random = Math.random,
  // The active System's own resolved ability-block field defs/key
  // (crucible/js/app.js's own abilityFieldDefs/abilityFieldKey, already
  // fetched once with the GM's real abilityField preference applied) and
  // combatBindings — passed in rather than re-fetched here, both to avoid a
  // second, preference-less fetch (confirmed real bug this fixes: this
  // function used to call loadAbilityFieldDefs a SECOND time with no
  // preferredKey at all, silently ignoring whatever the GM had configured in
  // Settings) and so every value this function writes can route through
  // setAtBinding against wherever THIS System's own combatBindings/
  // abilityField actually point, never a hardcoded field name.
  abilityFieldDefs = [],
  abilityFieldKey = "",
  combatBindings = null,
  derivedFormulas = [],
}) {
  const [levels, damageTypeList] = await Promise.all([
    loadCombatScalingLevels(dataManager, systemId, combatScalingField || undefined),
    loadDamageTypesPropertyType(dataManager, systemId),
  ]);

  const level = resolveCombatScalingLevel(levels, combatScalingId, random);
  const tendencies = role?.mechanicalTendencies || {};

  const baseHitPoints = Number(level?.hitPoints ?? 10);
  const baseArmorClass = Number(level?.armorClass ?? 10);
  const baseDamagePerRound = Number(level?.damagePerRound ?? 0);
  const attackBonus = Number(level?.attackBonus ?? 0);
  const saveDC = Number(level?.saveDC ?? 10);
  // Authored per Combat-Scaling-level (sys.dnd5e.json's own `challengeRating`
  // field, same "flat value per CR" convention as attackBonus/saveDC/
  // damagePerRound/targetBudget above) rather than computed from a numeric
  // CR — CR is otherwise only ever stored as a display string
  // (`stats.challengeRating`, e.g. "1/2"), never a number, so deriving this
  // via a formula would mean parsing that string right back into one. Never
  // set here before this — formula-mode weapon-attack/save-effect Features
  // (monster-feature-matching.js's own featureParams `ability` shape) are
  // what actually consume it, computing a live attack bonus/save DC from
  // THIS monster's own ability scores instead of a number baked into text.
  const proficiencyBonus = Number(level?.proficiencyBonus ?? 0);

  const hitPoints = Math.max(1, Math.round(baseHitPoints * (HP_BAND_MULTIPLIER[tendencies.hpBand] ?? 1)));
  const armorClass = Math.round(baseArmorClass * (AC_BAND_MULTIPLIER[tendencies.acBand] ?? 1));
  const damagePerRound = Math.max(0, Math.round(baseDamagePerRound * (DAMAGE_PROFILE_MULTIPLIER[tendencies.damageProfile] ?? 1)));

  const budgetTarget = Number(level?.targetBudget ?? 0);
  const spent = features.reduce((sum, feature) => sum + Number(feature.budgetCost ?? 0), 0);
  const budget = { target: budgetTarget, spent, remaining: budgetTarget - spent };

  const actions = buildActions(features, damagePerRound, attackBonus, damageTypeList);
  if (MULTIATTACK_ACTION_ECONOMIES.has(tendencies.actionEconomy) && actions.length === 1 && actions[0].name === "Attack") {
    actions[0].name = "Multiattack";
    actions[0].attackCount = 2;
  }

  const abilities = deriveAbilities(role, abilityFieldDefs);
  const initiativeBonus = abilityModifier(abilities.dexterity ?? 10, derivedFormulas);

  // Every value below is written through setAtBinding against a scratch
  // object, then unwrapped to just its own `.stats` sub-object at the end —
  // this keeps this function's own external contract (a plain `{ stats }`
  // wrapper) unchanged while routing each value through wherever the active
  // System's own combatBindings/abilityField actually declare, never a
  // hardcoded field name (see forge/js/lib/tables.js#getStatsForArchetype,
  // which uses the exact same technique — kept in sync, don't drift the two
  // apart).
  const scratch = {};

  // Ability scores — the one structural nesting always applied (stats.*);
  // the sub-key itself is 100% dynamic (abilityFieldKey).
  setAtBinding(`@stats.${abilityFieldKey || "abilities"}`, scratch, abilities);

  // HP-like resource.
  const primaryResource = findBindingsByRole(combatBindings, "resource")[0];
  if (primaryResource) {
    setAtBinding(primaryResource.binding, scratch, hitPoints);
    if (primaryResource.maxPath) setAtBinding(primaryResource.maxPath, scratch, hitPoints);
  }

  // AC-like single value.
  const valueBinding = findBindingByRole(combatBindings, "value");
  if (valueBinding) setAtBinding(valueBinding.binding, scratch, armorClass);

  // Initiative — not authored data at all, derived from `abilities.dexterity`
  // (D&D's own ability key) via the standard ability-modifier formula. This
  // one piece of D&D-specific rules logic has no data-driven home on a
  // System record — same documented exception the HP-band Constitution bonus
  // above already carries. Only WHERE this gets written comes from the
  // System's own combatBindings; a System with no `modifier`-role binding at
  // all (Daggerheart) simply never reaches this. `{bonus}` — this suite's
  // one shared initiative shape (see the monster-data-alignment plan),
  // matching every import mapping's own initiative and Character's own
  // initiativeTable exactly.
  const modifierBinding = findBindingByRole(combatBindings, "modifier");
  if (modifierBinding) setAtBinding(modifierBinding.binding, scratch, { bonus: initiativeBonus });

  // Everything else here has no combatBindings role to route through (no
  // System defines a "role" for Challenge Rating, Save DC, Proficiency Bonus,
  // Defenses, Senses, Actions, or Budget) — these are already this suite's
  // own shared stats.* shape regardless of System (see the monster-data-
  // alignment plan), so they apply the same "stats." structural prefix
  // directly rather than needing a per-System path lookup.
  const rest = {
    // shortName, not id — id is only ever an internal slug (e.g.
    // "cr-1-2"), never meant to be shown to a GM. shortName is the real,
    // portable CR value (e.g. "1/2") — see combat-scaling.js's own
    // shortName fallback for why it's always populated regardless of
    // whether the active System's own combat-scaling field authors one.
    challengeRating: level?.shortName || null,
    saveDC,
    proficiencyBonus,
    // `defenses` — this suite's one shared shape for resistances/
    // immunities/vulnerabilities/condition-immunities (see the monster-
    // data-alignment plan), matching every import mapping's own defenses
    // function and Character's own proficiencies.defenses exactly.
    // Condition immunities fold into the same array as `type:
    // "immunity"` too — no separate bucket, same convention Character's
    // own data already uses. No native concept of languages — a
    // generated monster's `proficiencies.languages` stays absent.
    proficiencies: {
      defenses: [
        ...(creatureType?.defaultResistances || []).map((name) => ({ name, type: "resistance" })),
        ...(creatureType?.defaultVulnerabilities || []).map((name) => ({ name, type: "vulnerability" })),
        ...(creatureType?.defaultImmunities || []).map((name) => ({ name, type: "immunity" })),
        ...(creatureType?.defaultConditionImmunities || []).map((name) => ({ name, type: "immunity" })),
      ],
    },
    // {passives:{perception}, darkvision, blindsight, ...} — this suite's
    // one shared senses shape (see monster-data-alignment plan), matching
    // every import mapping's own senses function and Character's own
    // sensesTable. defaultSenses on the creature type already carries this
    // exact structured shape (sys.dnd5e.json); passive Perception isn't
    // authored there since it depends on the generated monster's own
    // Wisdom, not the creature type — same "10 + modifier" formula
    // Character's own sensesTable uses. Falls back to 10 (flat +0) if
    // this System's abilities don't include a "wisdom" key at all, same
    // fallback convention initiative.bonus above uses for dexterity.
    senses: {
      ...(creatureType?.defaultSenses || {}),
      passives: { perception: 10 + abilityModifier(abilities.wisdom ?? 10, derivedFormulas) },
    },
    actions,
    budget,
  };
  Object.entries(rest).forEach(([key, value]) => setAtBinding(`@stats.${key}`, scratch, value));

  return { stats: scratch.stats || {} };
}
