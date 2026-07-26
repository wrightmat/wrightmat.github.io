// Derives a starting combat stat block for a generated monster from what's
// already been selected (a resolved combatScaling level, the Role, the
// Creature Type, and the chosen features) — a reasonable jumping-off point
// for a GM to hand-tune, not a rigorous combat simulator. Mirrors Vault's
// budget mechanic (js/lib/generator.js#computeBudget) for the feature-spend
// side of things, and pulls scaling targets from the active System's
// combatScaling field (tables.js#loadCombatScalingLevels) exactly the way
// Vault pulls Rarity/Activation/Form from its own generator-property fields.
import { loadCombatScalingLevels, loadDamageTypesPropertyType } from "./tables.js";
import { abilityModifier } from "../../../common/js/lib/dnd-rules.js";

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

function deriveAbilities(role) {
  const tendencies = role?.mechanicalTendencies || {};
  const damageProfile = tendencies.damageProfile || "";
  const isRanged = RANGED_DAMAGE_PROFILES.has(damageProfile);
  const primaryKey = isRanged ? "dexterity" : "strength";
  const abilities = {
    strength: 10,
    dexterity: 10,
    constitution: 10,
    intelligence: 10,
    wisdom: 10,
    charisma: 10,
  };
  const primaryBoost = DAMAGE_PROFILE_MULTIPLIER[damageProfile] ? Math.round((DAMAGE_PROFILE_MULTIPLIER[damageProfile] - 1) * 8) : 0;
  abilities[primaryKey] = clamp(14 + primaryBoost, 8, 20);
  abilities.constitution = clamp(12 + (CON_BAND_BONUS[tendencies.hpBand] ?? 0), 8, 20);
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
 * deriveStats({ systemId, combatScalingId, role, creatureType, features, dataManager, random })
 *
 * `role`/`creatureType` are the already-resolved records (same ones
 * generateMonster resolved), `features` the already-resolved selected
 * feature records. Every input degrades gracefully: a System with no
 * combatScaling/damageTypes data still produces a bare-minimum stat block
 * instead of an error.
 */
export async function deriveStats({
  systemId,
  combatScalingId = "",
  role = null,
  creatureType = null,
  features = [],
  dataManager,
  random = Math.random,
}) {
  const [levels, damageTypeList] = await Promise.all([
    loadCombatScalingLevels(dataManager, systemId),
    loadDamageTypesPropertyType(dataManager, systemId),
  ]);

  const level = resolveCombatScalingLevel(levels, combatScalingId, random);
  const tendencies = role?.mechanicalTendencies || {};

  const baseHitPoints = Number(level?.hitPoints ?? 10);
  const baseArmorClass = Number(level?.armorClass ?? 10);
  const baseDamagePerRound = Number(level?.damagePerRound ?? 0);
  const attackBonus = Number(level?.attackBonus ?? 0);
  const saveDC = Number(level?.saveDC ?? 10);

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

  const abilities = deriveAbilities(role);

  return {
    stats: {
      challengeRating: level?.id || null,
      armorClass,
      // { max, current } — the shape every kind's stats.hitPoints uses now
      // (see undercroft/common/js/lib/widgets/combat-tracker.js#addCombatant).
      // A freshly generated monster is undamaged, so current starts at max.
      hitPoints: { max: hitPoints, current: hitPoints },
      abilities,
      // Combat Tracker's "Roll Initiative" button reads this via the
      // System's combatBindings (sys.dnd5e.json's Initiative modifier
      // binding) rather than deriving it itself — the D&D-specific math
      // stays here in the 5e generator, not in system-agnostic tracker code.
      initiativeBonus: abilityModifier(abilities.dexterity),
      saveDC,
      damageResistances: creatureType?.defaultResistances || [],
      damageImmunities: creatureType?.defaultImmunities || [],
      conditionImmunities: [],
      senses: creatureType?.defaultSenses || [],
      actions,
      budget,
    },
  };
}
