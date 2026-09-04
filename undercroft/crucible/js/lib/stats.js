// Derives a starting combat stat block from a resolved combatScaling level,
// Role, Creature Type, and the chosen features — a jumping-off point for a
// GM to hand-tune, not a rigorous combat simulator.
import { loadCombatScalingLevels, loadDamageTypesPropertyType } from "./tables.js";
import { abilityModifier } from "../../../common/js/lib/derived-formulas.js";
import { setAtBinding, findBindingByRole, findBindingsByRole } from "../../../common/js/lib/bindings.js";

function pickRandom(list, random) {
  if (!list.length) return null;
  return list[Math.floor(random() * list.length)];
}

// Role's mechanicalTendencies bands are a small, fixed, human-readable
// vocabulary — translated here into rough multipliers/bonuses scoped to
// this file only, not promoted to a System/Role schema field.
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

// `abilityFieldDefs` supplies the SET of ability keys from the active
// System's own "abilities" field, not a hardcoded six-key copy. Which key is
// "primary" for melee/ranged and which gets the HP-band Constitution bonus
// is still D&D-specific rules logic with no data-driven home (the FORMULA is
// data-driven via derivedFormulas, just not which key feeds it) — so those
// two boosts only apply if the key set actually contains "strength"/
// "dexterity"/"constitution"; a System without one just skips that boost.
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
  // A generic melee/natural attack defaults to Bludgeoning (list order is
  // authoring order, not a preference ranking) when nothing selected
  // specifies its own damageType.
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

// `role`/`creatureType`/`features` are the already-resolved records
// generateMonster produced. Every input degrades gracefully: a System with
// no combatScaling/damageTypes data still produces a bare-minimum stat block
// instead of an error. Which field IS the Combat Scaling data is the
// System's own `fieldRoles` declaration — loadCombatScalingLevels resolves
// it internally, nothing to thread through here any more.
export async function deriveStats({
  systemId,
  combatScalingId = "",
  role = null,
  creatureType = null,
  features = [],
  dataManager,
  random = Math.random,
  // Passed in (already fetched with the GM's real preferences applied)
  // rather than re-fetched here, so every value this function writes routes
  // through setAtBinding against wherever THIS System's combatBindings/
  // abilityField actually point, never a hardcoded field name.
  abilityFieldDefs = [],
  abilityFieldKey = "",
  combatBindings = null,
  derivedFormulas = [],
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
  // Authored per Combat-Scaling-level rather than computed from a numeric CR
  // — CR is only ever stored as a display string (e.g. "1/2"), never a
  // number, so deriving this via formula would mean parsing that string back.
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

  // Every value below is written via setAtBinding against a scratch object,
  // then unwrapped to `.stats` at the end — routes each value through
  // wherever the active System's combatBindings/abilityField declare,
  // never a hardcoded field name (same technique as forge/js/lib/tables.js's
  // getStatsForArchetype — keep the two in sync).
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

  // Initiative is derived from `abilities.dexterity` via the standard
  // ability-modifier formula — same documented D&D-specific exception as the
  // HP-band Constitution bonus above. Only WHERE it's written comes from the
  // System's combatBindings; no `modifier`-role binding (Daggerheart) means
  // this is skipped. `{bonus}` matches every import mapping's own initiative
  // shape and Character's own initiativeTable.
  const modifierBinding = findBindingByRole(combatBindings, "modifier");
  if (modifierBinding) setAtBinding(modifierBinding.binding, scratch, { bonus: initiativeBonus });

  // Everything else here has no combatBindings role to route through (no
  // System defines a "role" for CR, Save DC, Proficiency Bonus, Defenses,
  // Senses, Actions, or Budget) — these are the suite's own shared stats.*
  // shape regardless of System, so they apply the "stats." prefix directly.
  const rest = {
    // shortName, not id — id is an internal slug (e.g. "cr-1-2"); shortName
    // is the portable display value (e.g. "1/2").
    challengeRating: level?.shortName || null,
    saveDC,
    proficiencyBonus,
    // `defenses` — the suite's shared resistance/immunity/vulnerability
    // shape, matching every import mapping and Character's own
    // proficiencies.defenses. Condition immunities fold into the same array
    // as `type: "immunity"`, same convention Character's data already uses.
    proficiencies: {
      defenses: [
        ...(creatureType?.defaultResistances || []).map((name) => ({ name, type: "resistance" })),
        ...(creatureType?.defaultVulnerabilities || []).map((name) => ({ name, type: "vulnerability" })),
        ...(creatureType?.defaultImmunities || []).map((name) => ({ name, type: "immunity" })),
        ...(creatureType?.defaultConditionImmunities || []).map((name) => ({ name, type: "immunity" })),
      ],
    },
    // {passives:{perception}, darkvision, blindsight, ...} — the suite's
    // shared senses shape, matching every import mapping and Character's own
    // sensesTable. Passive Perception isn't authored on the creature type
    // (it depends on this monster's own Wisdom) — same "10 + modifier"
    // formula Character uses, falling back to 10 if there's no "wisdom" key.
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
